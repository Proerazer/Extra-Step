const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    // Define the /unclaim command
    data: new SlashCommandBuilder()
        .setName('unclaim')
        .setDescription('Unclaim the currently assigned ticket')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages), // Staff-only access

    async execute(interaction, client, reporterTickets, staffClaims) {
        // Remove the staff member's claim from the map
        staffClaims.delete(interaction.user.id);

        // Confirm silently that the claim has been removed
        return interaction.reply({
            content: '✅ You have unclaimed this ticket.',
            ephemeral: true // Only visible to the staff member
        });
    }
};