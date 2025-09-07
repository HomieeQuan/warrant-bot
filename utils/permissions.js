// Define role hierarchy and permissions
const ROLE_PERMISSIONS = {
    '.': ['check', 'bulk-check', 'watch', 'maintenance'], // Full access
    'HR | Executive Operator': ['check', 'bulk-check', 'watch', 'maintenance'],
    'Senior Executive Operator': ['check', 'bulk-check', 'watch', 'maintenance'],
    'Special Weapons and Tactics': ['check'] // Only check command
};

/**
 * Check if user has permission to use a command
 * @param {Interaction} interaction - Discord interaction
 * @param {string} commandName - Name of the command
 * @returns {boolean} - True if user has permission
 */
function hasPermission(interaction, commandName) {
    // Get member's roles
    const member = interaction.member;
    if (!member) return false;

    // Check each role the user has
    for (const [roleName, roleData] of member.roles.cache) {
        // Check role by name
        const role = member.guild.roles.cache.find(r => r.name === roleName);
        if (role) {
            // Check if this role name exists in our permissions
            for (const [permRole, commands] of Object.entries(ROLE_PERMISSIONS)) {
                if (role.name === permRole && commands.includes(commandName)) {
                    return true;
                }
            }
        }
    }

    // Also check by role name directly (more reliable)
    for (const [permRole, commands] of Object.entries(ROLE_PERMISSIONS)) {
        if (member.roles.cache.some(role => role.name === permRole)) {
            if (commands.includes(commandName)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Silent deny - returns true if command should be ignored
 * @param {Interaction} interaction 
 * @param {string} commandName 
 * @returns {boolean} - True if should deny silently
 */
async function checkPermissionSilent(interaction, commandName) {
    if (!hasPermission(interaction, commandName)) {
        // Silent denial - don't reply at all
        console.log(`🚫 Permission denied for ${interaction.user.tag} on command: ${commandName}`);
        return true; // Should deny
    }
    return false; // Permission granted
}

/**
 * Get users with specific roles for notifications
 * @param {Guild} guild - Discord guild
 * @param {Array<string>} roleNames - Array of role names to check
 * @returns {Array<GuildMember>} - Array of members with those roles
 */
function getMembersWithRoles(guild, roleNames) {
    const members = [];
    
    guild.members.cache.forEach(member => {
        for (const roleName of roleNames) {
            if (member.roles.cache.some(role => role.name === roleName)) {
                members.push(member);
                break; // Don't add same member twice
            }
        }
    });
    
    return members;
}

module.exports = {
    hasPermission,
    checkPermissionSilent,
    getMembersWithRoles,
    ROLE_PERMISSIONS
};