const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();

app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        // origin: "http://localhost:5173",
         origin: "*",
        methods: ["GET", "POST"]
    }
});

const MAX_GROUP_MEMBERS = 4;

// All groups
const groups = {};


// ==========================================
// Generate unique group ID
// ==========================================

function generateGroupId() {
    let groupId;

    do {
        groupId =
            "GROUP-" +
            Math.floor(1000 + Math.random() * 9000);
    } while (groups[groupId]);

    return groupId;
}


// ==========================================
// Create player
// ==========================================

function createPlayer(socket, username, role) {
    return {
        id: socket.id,
        username,
        role,
        online: true
    };
}


// ==========================================
// Send current group state
// ==========================================

function updateGroup(groupId) {
    const group = groups[groupId];

    if (!group) {
        return;
    }

    io.to(groupId).emit("group-updated", {
        groupId: group.id,
        leaderId: group.leaderId,
        members: group.members
    });
}


// ==========================================
// Remove player from current group
// ==========================================

function removeFromGroup(socket) {
    const groupId = socket.groupId;

    if (!groupId) {
        return;
    }

    const group = groups[groupId];

    if (!group) {
        socket.groupId = null;
        return;
    }

    const leavingPlayer = group.members.find(
        member => member.id === socket.id
    );

    if (!leavingPlayer) {
        socket.groupId = null;
        return;
    }

    const wasLeader =
        group.leaderId === socket.id;

    // Remove player
    group.members = group.members.filter(
        member => member.id !== socket.id
    );

    // Remove socket from room
    socket.leave(groupId);

    console.log(
        `${leavingPlayer.username} left ${groupId}`
    );

    // Empty group
    if (group.members.length === 0) {

        delete groups[groupId];

        console.log(
            `Deleted ${groupId}`
        );

    } else {

        // Leader left
        if (wasLeader) {

            const newLeader =
                group.members[0];

            newLeader.role = "leader";

            group.leaderId =
                newLeader.id;

            console.log(
                `${newLeader.username} is now leader`
            );
        }

        updateGroup(groupId);
    }

    socket.groupId = null;
}


// ==========================================
// Connection
// ==========================================

io.on("connection", (socket) => {

    console.log(
        "CONNECTED:",
        socket.id
    );


    // ======================================
    // CREATE GROUP
    // ======================================

    socket.on("create-group", (username) => {

        // Don't allow creating another group
        if (socket.groupId) {

            socket.emit("group-error", {
                message:
                    "You are already in a group."
            });

            return;
        }

        username = username?.trim();

        if (!username) {

            socket.emit("group-error", {
                message:
                    "Username is required."
            });

            return;
        }


        const groupId =
            generateGroupId();


        const player =
            createPlayer(
                socket,
                username,
                "leader"
            );


        groups[groupId] = {

            id: groupId,

            leaderId: player.id,

            members: [
                player
            ]

        };


        socket.groupId = groupId;

        socket.join(groupId);


        console.log(
            `${username} created ${groupId}`
        );


        socket.emit("group-created", {
            groupId,
            leaderId: player.id,
            members: groups[groupId].members
        });

    });


    // ======================================
    // JOIN GROUP
    // ======================================

    socket.on(
        "join-group",
        ({ groupId, username }) => {

            // Already in a group
            if (socket.groupId) {

                socket.emit("group-error", {
                    message:
                        "You are already in a group."
                });

                return;
            }


            username = username?.trim();

            groupId =
                groupId?.trim().toUpperCase();


            if (!username) {

                socket.emit("group-error", {
                    message:
                        "Username is required."
                });

                return;
            }


            const group =
                groups[groupId];


            if (!group) {

                socket.emit("group-error", {
                    message:
                        "Group does not exist."
                });

                return;
            }


            // Group full
            if (
                group.members.length >=
                MAX_GROUP_MEMBERS
            ) {

                socket.emit("group-error", {
                    message:
                        "Group is full."
                });

                return;
            }


            // Prevent duplicate socket
            const alreadyMember =
                group.members.some(
                    member =>
                        member.id === socket.id
                );

            if (alreadyMember) {

                socket.emit("group-error", {
                    message:
                        "You are already in this group."
                });

                return;
            }


            const player =
                createPlayer(
                    socket,
                    username,
                    "member"
                );


            group.members.push(player);

            socket.groupId = groupId;

            socket.join(groupId);


            console.log(
                `${username} joined ${groupId}`
            );


            // Send complete state
            socket.emit("group-joined", {
                groupId,
                leaderId: group.leaderId,
                members: group.members
            });


            // Update everyone
            updateGroup(groupId);
        }
    );


    // ======================================
    // LEAVE GROUP
    // ======================================

    socket.on("leave-group", () => {

        removeFromGroup(socket);

    });


    // ======================================
    // DISCONNECT
    // ======================================

    socket.on("disconnect", () => {

        console.log(
            "DISCONNECTED:",
            socket.id
        );

        removeFromGroup(socket);

    });
    // ===============================
// WEBRTC SIGNALING
// ===============================

socket.on("webrtc-offer", ({ target, offer }) => {
    io.to(target).emit("webrtc-offer", {
        sender: socket.id,
        offer
    });
});

socket.on("webrtc-answer", ({ target, answer }) => {
    io.to(target).emit("webrtc-answer", {
        sender: socket.id,
        answer
    });
});

socket.on("webrtc-ice-candidate", ({ target, candidate }) => {
    io.to(target).emit("webrtc-ice-candidate", {
        sender: socket.id,
        candidate
    });
});

});


app.get("/", (req, res) => {
    res.send("PUBG Group Server is running");
});


server.listen(5000, () => {

    console.log(
        "Server running on http://localhost:5000"
    );

});