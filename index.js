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

// Utilities
const { addBan, isBanned } = require('./utils/banManager');

// Optional support server invite for appeals
const SUPPORT_SERVER_INVITE = 'https://discord.gg/YOUR_SUPPORT_INVITE';

// Track users linked to ticket channels and staff claims
const reporterTickets = new Map(); // reporterId => ticketChannel
const staffClaims = new Map();     // staffId => reporterId

// Create bot client
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

// Load all slash commands
client.commands = new Collection();
const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
    commands.push(command.data.toJSON());
}

// Register slash commands
const { REST, Routes } = require('discord.js');
const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
    try {
        console.log('🔁 Registering slash commands...');

        // Global command registration (slow)
        await rest.put(
            Routes.applicationCommands(config.clientId),
            { body: commands }
        );
        console.log('🌍 Global slash commands submitted. May take up to 1 hour to update.');

        // Guild-specific command registration (fast)
        await rest.put(
            Routes.applicationGuildCommands(config.clientId, config.guildId),
            { body: commands }
        );
        console.log(`⚡ Instant commands updated for guild ${config.guildId}.`);

    } catch (error) {
        console.error('❌ Error registering slash commands:', error);
    }
})();

// Handle all interactions
client.on(Events.InteractionCreate, async interaction => {
    // Slash commands
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        try {
            await command.execute(interaction, client, reporterTickets, staffClaims);
        } catch (err) {
            console.error(err);
            await interaction.reply({ content: '⚠️ Error executing command.', ephemeral: true });
        }
    }

    // Buttons (Approve / Reject)
    if (interaction.isButton()) {
        const [action, userId] = interaction.customId.split(':');
        const member = await interaction.guild.members.fetch(userId).catch(() => null);

        const channel = interaction.channel;
        const reporterId = channel.topic?.replace('Report by ', '').trim();
        const reporter = reporterId ? await client.users.fetch(reporterId).catch(() => null) : null;

        if (action === 'approve') {
            // Approve the report: ban user + store in bans.json
            try {
                if (member) {
                    await member.ban({ reason: 'Approved by staff via ticket system' });
                    await interaction.reply(`✅ <@${userId}> has been banned.`);
                } else {
                    await interaction.reply(`⚠️ User not found in this server. Manual action may be needed.`);
                }

                addBan(userId, `Approved by ${interaction.user.tag}`);

                // Notify reporter
                if (reporter) {
                    await reporter.send(`✅ Your report against <@${userId}> was approved and action was taken.`);
                }

                // Close channel after 24 hours
                setTimeout(() => {
                    interaction.channel.delete().catch(console.error);
                }, 86400000);

            } catch (err) {
                console.error(err);
                await interaction.reply({ content: '❌ Failed to ban the user.', ephemeral: true });
            }
        }

        if (action === 'reject') {
            // Ask staff for rejection reason using a modal
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

    // Modal response for rejection reason
    if (interaction.isModalSubmit() && interaction.customId.startsWith('reject_reason:')) {
        const [, userId, reporterId] = interaction.customId.split(':');
        const reason = interaction.fields.getTextInputValue('reason');

        // Public message in ticket channel
        await interaction.reply({
            content: `❌ Ban rejected for <@${userId}>.\n**Reason:** ${reason}`
        });

        // DM the reporter if available
        if (reporterId) {
            try {
                const reporter = await client.users.fetch(reporterId);
                await reporter.send(`❌ Your report against <@${userId}> was denied.\n**Reason:** ${reason}`);
            } catch {
                console.warn(`Could not DM reporter (${reporterId}) about rejection.`);
            }
        }

        // Schedule channel deletion after 24 hours
        setTimeout(() => {
            interaction.channel.delete().catch(console.error);
        }, 86400000);
    }
});

// Forward messages from staff to reporters (based on claims)
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!staffClaims.has(message.author.id)) return;
    if (message.channel.type === ChannelType.DM) return;

    const reporterId = staffClaims.get(message.author.id);
    const reporter = await client.users.fetch(reporterId).catch(() => null);
    if (!reporter) return;

    // Forward text or attachments
    try {
        if (message.content.trim()) {
            await reporter.send(`💬 Message from staff:\n${message.content}`);
        }

        if (message.attachments.size > 0) {
            for (const file of message.attachments.values()) {
                await reporter.send({ files: [file.url] });
            }
        }
    } catch (err) {
        console.warn(`Failed to DM reporter ${reporterId}`);
    }
});

// Evidence forwarding from reporters → ticket
client.on('messageCreate', async message => {
    if (message.channel.type !== ChannelType.DM) return;
    if (message.author.bot) return;
    if (!reporterTickets.has(message.author.id)) return;

    const ticketChannel = reporterTickets.get(message.author.id);
    if (!ticketChannel) return;

    // Forward message content
    if (message.content.trim()) {
        await ticketChannel.send(`📝 From ${message.author.tag}:\n${message.content}`);
    }

    // Forward any attachments
    if (message.attachments.size > 0) {
        const files = message.attachments.map(att => ({
            attachment: att.url,
            name: att.name
        }));
        await ticketChannel.send({ files });
    }
});

// ✅ Appeal system: DM users who are banned when they join
client.on('guildMemberAdd', async member => {
    if (isBanned(member.id)) {
        try {
            await member.send({
                content: `⚠️ You are currently banned from affiliated communities.\nIf you believe this was a mistake, you can appeal here:\n${SUPPORT_SERVER_INVITE}`
            });
        } catch {
            console.warn(`Could not DM banned user ${member.user.tag}`);
        }
    }
});

// Bot online confirmation
client.once(Events.ClientReady, () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);
});

// Start the bot
client.login(config.token);

// Export shared maps for use in other modules
module.exports = {
    reporterTickets,
    staffClaims
};
