const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    // Define the /claim command using Discord's slash command builder
    data: new SlashCommandBuilder()
        .setName('claim')
        .setDescription('Claim the current report ticket')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages), // Only staff can use

    async execute(interaction, client, reporterTickets, staffClaims) {
        const channel = interaction.channel;

        // We expect the channel topic to be in the format: 'Report by USER_ID'
        const topic = channel.topic;

        // If the channel has no topic or an incorrect one, deny the command
        if (!topic || !topic.startsWith('Report by ')) {
            return interaction.reply({
                content: '❌ This command can only be used inside a valid report ticket channel.',
                ephemeral: true
            });
        }

        // Extract the reporter's user ID from the channel topic
        const reporterId = topic.replace('Report by ', '').trim();

        let reporter;
        try {
            // Try to fetch the reporter using the stored user ID
            reporter = await client.users.fetch(reporterId);
        } catch {
            // If the user is not found (blocked bot or invalid ID)
            return interaction.reply({
                content: '❌ Could not find the reporter. They may have blocked the bot or left Discord.',
                ephemeral: true
            });
        }

        // Store the claim: maps staff user ID → reporter user ID
        staffClaims.set(interaction.user.id, reporter.id);

        // Let the staff member know the claim was successful (only to them)
        return interaction.reply({
            content: `✅ You have claimed this ticket. All your messages here will now be sent to ${reporter.tag}.`,
            ephemeral: true
        });
    }
};