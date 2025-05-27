const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('close')
        .setDescription('Closes this report channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels), // Only staff by default

    async execute(interaction) {
        const channel = interaction.channel;

        // Optional: Only allow closing ticket-like channels
        if (!channel.name.startsWith('report-')) {
            return await interaction.reply({ content: 'This command can only be used inside a report channel.', ephemeral: true });
        }

        await interaction.reply(`🛑 This ticket is being closed by <@${interaction.user.id}>. Channel will be deleted in 5 seconds.`);

        setTimeout(() => {
            channel.delete().catch(err => {
                console.error('Failed to delete channel:', err);
            });
        }, 5000);
    }
};