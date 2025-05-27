const fs = require('fs');
const path = require('path');

// Define the path to the bans.json file
const filePath = path.join(__dirname, '../bans.json');

// Loads the current list of bans from the JSON file
function loadBans() {
    // If the file doesn't exist, create an empty one
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify([]));
    
    // Read and parse the file contents
    return JSON.parse(fs.readFileSync(filePath));
}

// Saves the current ban list back to bans.json
function saveBans(banList) {
    fs.writeFileSync(filePath, JSON.stringify(banList, null, 2));
}

// Adds a new banned user to the list (if not already there)
function addBan(userId, reason) {
    const bans = loadBans();

    // Only add if this user hasn't already been banned
    if (!bans.find(entry => entry.userId === userId)) {
        bans.push({
            userId,                  // The banned user's ID
            reason,                 // The reason for the ban (provided by staff)
            timestamp: new Date().toISOString() // Time of ban
        });
        saveBans(bans);
    }
}

// Checks if a given user ID is in the ban list
function isBanned(userId) {
    const bans = loadBans();
    return bans.some(entry => entry.userId === userId);
}

// Export the functions so they can be used in index.js and elsewhere
module.exports = {
    loadBans,
    saveBans,
    addBan,
    isBanned
};