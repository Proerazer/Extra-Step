const {
  Client,
  GatewayIntentBits,
  Events,
  Collection,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType
} = require('discord.js');

const fs = require('fs');
const path = require('path');
const config = require('./config.json');
const { addBan, isBanned } = require('./utils/banManager');

// === Constants ===
const SUPPORT_SERVER_INVITE = 'https://discord.gg/h2VvjZqkrw';
const reporterTickets = new Map(); // reporterId → ticketChannel
const staffClaims = new Map();     // staffId → reporterId

// === Bot Client Setup ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// === Slash Command Registration ===
client.commands = new Collection();
const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.data.name, command);
  commands.push(command.data.toJSON());
}

const { REST, Routes } = require('discord.js');
const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
  try {
    console.log('🔁 Registering slash commands...');

    // Global (slow) registration
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    console.log('🌍 Global slash commands submitted.');

    // Instant registration in primary guild
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
    console.log(`⚡ Slash commands updated in guild ${config.guildId}.`);
  } catch (error) {
    console.error('❌ Slash command registration failed:', error);
  }
})();

// === Interaction Handlers ===
client.on(Events.InteractionCreate, async interaction => {
  // Slash command handler
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction, client, reporterTickets, staffClaims);
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: '⚠️ Command error.', ephemeral: true });
    }
  }

  // Button interactions (Approve / Reject)
  if (interaction.isButton()) {
    const [action, userId] = interaction.customId.split(':');
    const channel = interaction.channel;
    const reporterId = channel.topic?.replace('Report by ', '').trim();
    const reporter = reporterId ? await client.users.fetch(reporterId).catch(() => null) : null;

    if (action === 'approve') {
      try {
        // ✅ Attempt to ban user from every server the bot is in
        for (const [guildId, guild] of client.guilds.cache) {
          try {
            await guild.members.ban(userId, {
              reason: `Global ban approved by ${interaction.user.tag}`
            });
            console.log(`✅ Banned ${userId} in ${guild.name}`);
          } catch (err) {
            console.warn(`⚠️ Could not ban in ${guild.name}: ${err.message}`);
          }
        }

        // Store in persistent ban list
        addBan(userId, `Approved by ${interaction.user.tag}`);

        // DM the banned user
        try {
          const bannedUser = await client.users.fetch(userId);
          await bannedUser.send(`🚫 You have been banned from all affiliated communities. You may appeal here: ${SUPPORT_SERVER_INVITE}`);
        } catch {
          console.warn(`DM to banned user (${userId}) failed`);
        }

        // Notify reporter
        if (reporter) {
          await reporter.send(`✅ Your report against <@${userId}> was approved. The user has been banned.`);
        }

        // Confirm in the ticket channel
        await interaction.reply({ content: `✅ <@${userId}> has been globally banned.` });

        // Schedule deletion after 24h
        setTimeout(() => {
          interaction.channel.delete().catch(console.error);
        }, 86400000);
      } catch (err) {
        console.error(err);
        await interaction.reply({ content: '❌ Failed to process global ban.', ephemeral: true });
      }
    }

    // ❌ Reject button clicked
    if (action === 'reject') {
      const modal = new ModalBuilder()
        .setCustomId(`reject_reason:${userId}:${reporterId}`)
        .setTitle('Reject Report')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('reason')
              .setLabel('Why are you rejecting this report?')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
          )
        );

      await interaction.showModal(modal);
    }
  }

  // Modal submission (Rejection reason)
  if (interaction.isModalSubmit() && interaction.customId.startsWith('reject_reason:')) {
    const [, userId, reporterId] = interaction.customId.split(':');
    const reason = interaction.fields.getTextInputValue('reason');

    await interaction.reply({
      content: `❌ Report rejected for <@${userId}>.\n**Reason:** ${reason}`
    });

    if (reporterId) {
      try {
        const reporter = await client.users.fetch(reporterId);
        await reporter.send(`❌ Your report against <@${userId}> was denied.\n**Reason:** ${reason}`);
      } catch {
        console.warn(`❗ Could not notify reporter (${reporterId})`);
      }
    }

    setTimeout(() => {
      interaction.channel.delete().catch(console.error);
    }, 86400000);
  }
});

// === Message Forwarding Logic ===
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // Staff to reporter (via claim)
  if (staffClaims.has(message.author.id) && message.channel.type !== ChannelType.DM) {
    const reporterId = staffClaims.get(message.author.id);
    const reporter = await client.users.fetch(reporterId).catch(() => null);
    if (!reporter) return;

    if (message.content.trim()) {
      await reporter.send(`🛡️ Staff: ${message.content}`);
    }
    for (const file of message.attachments.values()) {
      await reporter.send({ files: [file.url] });
    }
  }

  // Reporter to ticket
  if (message.channel.type === ChannelType.DM && reporterTickets.has(message.author.id)) {
    const ticketChannel = reporterTickets.get(message.author.id);
    if (message.content.trim()) {
      await ticketChannel.send(`📩 From ${message.author.tag}: ${message.content}`);
    }
    if (message.attachments.size > 0) {
      const files = message.attachments.map(att => ({
        attachment: att.url,
        name: att.name
      }));
      await ticketChannel.send({ files });
    }
  }
});

// ✅ Ban appeal invite if banned user rejoins
client.on('guildMemberAdd', async member => {
  if (isBanned(member.id)) {
    try {
      await member.send(`🚫 You are currently banned from these communities.\nAppeal here: ${SUPPORT_SERVER_INVITE}`);
    } catch {
      console.warn(`❗ Could not DM banned user (${member.id})`);
    }
  }
});

// === Ready Event ===
client.once(Events.ClientReady, () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// === Start Bot ===
client.login(config.token);

// Export shared structures
module.exports = {
  reporterTickets,
  staffClaims
};