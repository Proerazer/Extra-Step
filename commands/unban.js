const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { loadBans, saveBans } = require('../utils/banManager');

module.exports = {
    // Define the slash command
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Remove a user from the permanent ban list and unban them from the server.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to unban')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers), // Staff-only

    async execute(interaction, client) {
        const user = interaction.options.getUser('user');

        // Load the ban list
        const bans = loadBans();

        // Check if the user is in the ban list
        const index = bans.findIndex(entry => entry.userId === user.id);
        if (index === -1) {
            return interaction.reply({
                content: `❌ <@${user.id}> is not in the ban database.`,
                ephemeral: true
            });
        }

        // Remove the user from the list and save
        bans.splice(index, 1);
        saveBans(bans);

        // Attempt to unban from the current server
        const guild = client.guilds.cache.get(interaction.guildId);
        try {
            await guild.members.unban(user.id);
        } catch {
            // Ignore if user wasn't banned in the server
        }

        return interaction.reply({
            content: `✅ <@${user.id}> has been removed from the permanent ban list.`,
            ephemeral: true
        });
    }
};