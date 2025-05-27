const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { loadBans, saveBans } = require('../utils/banManager');
const config = require('../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Remove a user from the permanent ban list and unban them from the server.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to unban')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers), // Only users with BanMembers permission can run this

    async execute(interaction, client) {
        // ✅ Restrict to the support server only
        if (interaction.guildId !== config.guildId) {
            return interaction.reply({
                content: '❌ This command can only be used in the support server.',
                ephemeral: true
            });
        }

        const user = interaction.options.getUser('user');
        const bans = loadBans();
        const index = bans.findIndex(entry => entry.userId === user.id);

        // ❌ Not banned
        if (index === -1) {
            return interaction.reply({
                content: `❌ <@${user.id}> is not in the global ban list.`,
                ephemeral: true
            });
        }

        // ✅ Remove from list
        bans.splice(index, 1);
        saveBans(bans);

        // 🔄 Attempt to unban from this server
        try {
            await interaction.guild.members.unban(user.id);
        } catch {
            // Ignore if not banned here
        }

        return interaction.reply({
            content: `✅ <@${user.id}> has been removed from the global ban list.`,
            ephemeral: true
        });
    }
};