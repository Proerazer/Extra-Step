const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ComponentType,
    ChannelType,
    PermissionFlagsBits,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const config = require('../config.json');

// Accurate Discord in-app reporting instructions
const reportGuides = {
    harassment: {
        steps: [
            'Right-click (or tap and hold) the message.',
            'Select **"Report Message"**.',
            'Go to **"Abuse or harassment"**.',
            'Follow the on-screen prompts to complete the report.'
        ]
    },
    spam: {
        steps: [
            'Right-click (or tap and hold) the message.',
            'Select **"Report Message"**.',
            'Go to **"Spam"**, or **"Something else" → "Impersonation, scam, or fraud"** OR **"Hacks, cheats, phishing or malicious links"**.',
            'Follow the on-screen prompts to complete the report.'
        ]
    },
    child: {
        steps: [
            'Right-click (or tap and hold) the message.',
            'Select **"Report Message"**.',
            'Go to **"Abuse or harassment" → "Content targeting or involving a minor"**.',
            'Follow the on-screen prompts to complete the report.',
            '🚨 If possible, contact emergency help local to the reported user immediately.'
        ]
    },
    impersonation: {
        steps: [
            'Right-click (or tap and hold) the message.',
            'Select **"Report Message"**.',
            'Go to **"Something else" → "Impersonation, scam, or fraud"**.',
            'Follow the on-screen prompts to complete the report.'
        ]
    },
    selfharm: {
        steps: [
            'Right-click (or tap and hold) the message.',
            'Select **"Report Message"**.',
            'Go to **"Something else" → "It mentions self-harm or suicide"**.',
            'Follow the on-screen prompts to complete the report.',
            '🚨 If possible, contact emergency help local to the reported user immediately.'
        ]
    },
    other: {
        steps: [
            'Right-click (or tap and hold) the message.',
            'Select **"Report Message"**.',
            'Follow the on-screen prompts to complete the report.'
        ]
    }
};

// 🛠 Defined above usage to prevent ReferenceError
async function proceedWithTicket(reporter, target, reasonText, reasonKey, client, reporterTickets) {
    const reportCategoryId = config.reportCategoryId;
    const channelName = `report-${reporter.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
    const guild = client.guilds.cache.get(config.guildId);

    let dmSent = false;
    try {
        await reporter.send(`📢 **Thanks for reporting ${target.tag}!**\nPlease reply to this DM with any evidence (screenshots/videos). Your evidence should include usernames and visible DM list if applicable.`);
        dmSent = true;
    } catch {}

    let reportChannel;
    try {
        reportChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: reportCategoryId,
            topic: `Report by ${reporter.id}`,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: client.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels]
                }
            ]
        });
    } catch (err) {
        console.error("Channel creation failed:", err);
        await reporter.send("❌ Failed to create the ticket channel. Please contact staff.");
        return;
    }

    reporterTickets.set(reporter.id, reportChannel);

    const embed = new EmbedBuilder()
        .setTitle('📩 New Report')
        .setDescription(`**User Reported:** <@${target.id}>\n**Reason:** ${reasonText}`)
        .setColor('Red')
        .setTimestamp()
        .setFooter({ text: reporter.tag });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`approve:${target.id}`).setLabel('✅ Approve Ban').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`reject:${target.id}`).setLabel('❌ Reject Report').setStyle(ButtonStyle.Danger)
    );

    await reportChannel.send({ content: 'Staff, please review the report below.', embeds: [embed], components: [row] });

    if (dmSent) {
        await reporter.send('✅ Your report was submitted! Please upload your evidence here.');
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('Start a multi-step process to report a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user you want to report')
                .setRequired(true)),

    async execute(interaction, client, reporterTickets) {
        const target = interaction.options.getUser('user');
        const reporter = interaction.user;

        let dmChannel;
        try {
            dmChannel = await reporter.createDM();

            await dmChannel.send({
                content: `You're reporting **${target.tag}**. Please select the reason below:`,
                components: [new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(`report-reason-${target.id}`)
                        .setPlaceholder('Select the reason for this report')
                        .addOptions([
                            { label: 'Harassment or Abuse', value: 'harassment' },
                            { label: 'Spam or Phishing', value: 'spam' },
                            { label: 'Child Endangerment / Online Dating', value: 'child' },
                            { label: 'Impersonation or Scamming', value: 'impersonation' },
                            { label: 'Self-Harm or Suicidal Intent', value: 'selfharm' },
                            { label: 'Other (custom reason)', value: 'other' }
                        ])
                )]
            });
        } catch (err) {
            return await interaction.reply({
                content: '❌ You must enable DMs to complete the report process.',
                ephemeral: true
            });
        }

        await interaction.reply({
            content: '📬 Please check your DMs to continue the report process.',
            ephemeral: true
        });

        const collector = dmChannel.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            time: 60000,
            max: 1
        });

        collector.on('collect', async selectInteraction => {
            let reasonKey = selectInteraction.values[0];
            const guide = reportGuides[reasonKey] || reportGuides.other;

            const instructions = `📨 **Before proceeding, please report this directly to Discord:**\n\n${guide.steps.map(s => `• ${s}`).join('\n')}`;
            await dmChannel.send(instructions);

            if (reasonKey === 'other') {
                await selectInteraction.update({
                    content: 'Please type your custom reason in this DM (you have 1 minute).',
                    components: []
                });

                const msgCollector = dmChannel.createMessageCollector({
                    filter: m => m.author.id === reporter.id,
                    time: 60000,
                    max: 1
                });

                msgCollector.on('collect', async msg => {
                    await proceedWithTicket(reporter, target, msg.content, reasonKey, client, reporterTickets);
                });
            } else {
                await selectInteraction.update({ content: '✅ Reason selected. Creating your report ticket...', components: [] });
                await proceedWithTicket(reporter, target, reasonKey, reasonKey, client, reporterTickets);
            }
        });
    }
};
