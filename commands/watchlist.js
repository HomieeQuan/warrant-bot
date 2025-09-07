const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { checkPermissionSilent } = require('../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('watchlist')
        .setDescription('View all active watches or clear all watches')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Action to perform')
                .setRequired(false)
                .addChoices(
                    { name: 'view', value: 'view' },
                    { name: 'clear-all', value: 'clear' }
                )
        ),

    async execute(interaction) {
        // Check permissions silently
        if (await checkPermissionSilent(interaction, 'watch')) {
            return; // Silent denial - same permissions as watch command
        }

        const action = interaction.options.getString('action') || 'view';
        
        // Get watch command to access active watches
        const watchCommand = interaction.client.commands.get('watch');
        if (!watchCommand) {
            await interaction.reply({
                content: '❌ Watch system not available.',
                ephemeral: true
            });
            return;
        }

        const activeWatches = watchCommand.getActiveWatches();

        // Handle clear-all action (admin only)
        if (action === 'clear') {
            // Check if user has admin role (.)
            const isAdmin = interaction.member.roles.cache.some(role => role.name === '.');
            
            if (!isAdmin) {
                await interaction.reply({
                    content: '⚠️ Only administrators can clear all watches.',
                    ephemeral: true
                });
                return;
            }

            // Clear all watches
            const watchCount = activeWatches.size;
            
            if (watchCount === 0) {
                await interaction.reply({
                    content: '📋 No active watches to clear.',
                    ephemeral: true
                });
                return;
            }

            // Stop all watches
            const usernames = Array.from(activeWatches.keys());
            let cleared = 0;
            
            for (const username of usernames) {
                if (watchCommand.stopWatch(username)) {
                    cleared++;
                }
            }

            // Create confirmation embed
            const embed = new EmbedBuilder()
                .setTitle('🗑️ All Watches Cleared')
                .setColor(0xFF0000)
                .setDescription(`Successfully cleared ${cleared} active watch(es)`)
                .addFields({
                    name: '📋 Cleared Watches',
                    value: usernames.join(', ') || 'None',
                    inline: false
                })
                .setFooter({ 
                    text: `Cleared by ${interaction.user.tag}` 
                })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
            console.log(`🗑️ All watches cleared by admin ${interaction.user.tag}`);
            return;
        }

        // Handle view action (default)
        if (activeWatches.size === 0) {
            const embed = new EmbedBuilder()
                .setTitle('📋 Active Watch List')
                .setColor(0x808080)
                .setDescription('No active watches currently running.')
                .setFooter({ 
                    text: `0/${watchCommand.MAX_CONCURRENT_WATCHES || 20} slots used` 
                })
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        // Build watch list embed
        const embed = new EmbedBuilder()
            .setTitle('📋 Active Watch List')
            .setColor(0x0099FF)
            .setDescription(`Currently monitoring ${activeWatches.size} user(s)`)
            .setTimestamp();

        // Add each watch as a field
        let fieldCount = 0;
        for (const [username, watchData] of activeWatches) {
            if (fieldCount >= 25) break; // Discord embed field limit

            const startTime = new Date(watchData.startTime);
            const endTime = new Date(watchData.endTime);
            const now = new Date();
            
            // Calculate time remaining
            const remainingMs = endTime - now;
            const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
            const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
            
            // Calculate time elapsed
            const elapsedMs = now - startTime;
            const elapsedHours = Math.floor(elapsedMs / (1000 * 60 * 60));
            const elapsedMinutes = Math.floor((elapsedMs % (1000 * 60 * 60)) / (1000 * 60));

            // Determine status emoji
            const statusEmoji = watchData.wasOnline ? '🟢' : '⚫';
            const errorIndicator = watchData.consecutiveErrors > 0 ? ' ⚠️' : '';

            embed.addFields({
                name: `${statusEmoji} ${username}${errorIndicator}`,
                value: `Started by: ${watchData.startedBy}\nElapsed: ${elapsedHours}h ${elapsedMinutes}m\nRemaining: ${remainingHours}h ${remainingMinutes}m`,
                inline: true
            });

            fieldCount++;
        }

        // Add footer with slot usage
        embed.setFooter({ 
            text: `${activeWatches.size}/${watchCommand.MAX_CONCURRENT_WATCHES || 20} slots used • Use /stopwatch to stop a watch` 
        });

        // Add admin hint if user is admin
        const isAdmin = interaction.member.roles.cache.some(role => role.name === '.');
        if (isAdmin) {
            embed.setDescription(`Currently monitoring ${activeWatches.size} user(s)\n*Admin: Use \`/watchlist action:clear-all\` to clear all watches*`);
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};