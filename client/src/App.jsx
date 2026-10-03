import { useEffect, useRef, useState } from "react";
import socket from "./socket";
import "./App.css";

const ICE_SERVERS = {
    iceServers: [
        {
            urls: "stun:stun.l.google.com:19302"
        }
    ]
};

function App() {
    const [username, setUsername] = useState("");
    const [groupInput, setGroupInput] = useState("");
    const [group, setGroup] = useState(null);
    const [error, setError] = useState("");
    const [connected, setConnected] = useState(socket.connected);

    const [micOn, setMicOn] = useState(false);

    // ===============================
    // WEBRTC REFS
    // ===============================

    const localStreamRef = useRef(null);

    const peerConnectionsRef = useRef({});

    const [remoteStreams, setRemoteStreams] = useState({});

    // ===============================
    // SOCKET EVENTS
    // ===============================

    useEffect(() => {
        function onConnect() {
            console.log("Socket connected:", socket.id);
            setConnected(true);
        }

        function onDisconnect() {
            console.log("Socket disconnected");
            setConnected(false);
        }

        function onGroupCreated(data) {
            console.log("GROUP CREATED:", data);

            setGroup({
                groupId: data.groupId,
                leaderId: data.leaderId,
                members: data.members
            });

            setError("");
        }

        function onGroupJoined(data) {
            console.log("GROUP JOINED:", data);

            setGroup({
                groupId: data.groupId,
                leaderId: data.leaderId,
                members: data.members
            });

            setError("");
        }

        function onGroupUpdated(data) {
            console.log("GROUP UPDATED:", data);

            setGroup({
                groupId: data.groupId,
                leaderId: data.leaderId,
                members: data.members
            });
        }

        function onGroupError(data) {
            console.error("GROUP ERROR:", data.message);
            setError(data.message);
        }

        // ==================================
        // WEBRTC EVENTS
        // ==================================

        async function onWebRTCOffer({ sender, offer }) {
            console.log("Received offer from:", sender);

            const pc = await createPeerConnection(sender);

            await pc.setRemoteDescription(
                new RTCSessionDescription(offer)
            );

            const answer = await pc.createAnswer();

            await pc.setLocalDescription(answer);

            socket.emit("webrtc-answer", {
                target: sender,
                answer
            });
        }

        async function onWebRTCAnswer({ sender, answer }) {
            console.log("Received answer from:", sender);

            const pc = peerConnectionsRef.current[sender];

            if (!pc) {
                console.error(
                    "No peer connection for:",
                    sender
                );
                return;
            }

            await pc.setRemoteDescription(
                new RTCSessionDescription(answer)
            );
        }

        async function onWebRTCIceCandidate({
            sender,
            candidate
        }) {
            try {
                const pc = peerConnectionsRef.current[sender];

                if (!pc) {
                    console.log(
                        "Peer connection not ready:",
                        sender
                    );
                    return;
                }

                await pc.addIceCandidate(
                    new RTCIceCandidate(candidate)
                );
            } catch (error) {
                console.error(
                    "ICE candidate error:",
                    error
                );
            }
        }

        socket.on("connect", onConnect);
        socket.on("disconnect", onDisconnect);

        socket.on("group-created", onGroupCreated);
        socket.on("group-joined", onGroupJoined);
        socket.on("group-updated", onGroupUpdated);
        socket.on("group-error", onGroupError);

        socket.on("webrtc-offer", onWebRTCOffer);
        socket.on("webrtc-answer", onWebRTCAnswer);
        socket.on(
            "webrtc-ice-candidate",
            onWebRTCIceCandidate
        );

        return () => {
            socket.off("connect", onConnect);
            socket.off("disconnect", onDisconnect);

            socket.off("group-created", onGroupCreated);
            socket.off("group-joined", onGroupJoined);
            socket.off("group-updated", onGroupUpdated);
            socket.off("group-error", onGroupError);

            socket.off("webrtc-offer", onWebRTCOffer);
            socket.off("webrtc-answer", onWebRTCAnswer);
            socket.off(
                "webrtc-ice-candidate",
                onWebRTCIceCandidate
            );
        };
    }, []);

    // ==========================================
    // CREATE PEER CONNECTION
    // ==========================================

    async function createPeerConnection(remoteId) {
        if (peerConnectionsRef.current[remoteId]) {
            return peerConnectionsRef.current[remoteId];
        }

        console.log(
            "Creating peer connection:",
            remoteId
        );

        const pc = new RTCPeerConnection(ICE_SERVERS);

        peerConnectionsRef.current[remoteId] = pc;

        // --------------------------------------
        // Add microphone tracks
        // --------------------------------------

        if (localStreamRef.current) {
            localStreamRef.current
                .getTracks()
                .forEach((track) => {
                    pc.addTrack(
                        track,
                        localStreamRef.current
                    );
                });
        }

        // --------------------------------------
        // Receive remote audio
        // --------------------------------------

        pc.ontrack = (event) => {
            console.log(
                "Received remote stream:",
                remoteId
            );

            const stream = event.streams[0];

            if (!stream) return;

            setRemoteStreams((prev) => ({
                ...prev,
                [remoteId]: stream
            }));
        };

        // --------------------------------------
        // ICE candidate
        // --------------------------------------

        pc.onicecandidate = (event) => {
            if (!event.candidate) return;

            socket.emit("webrtc-ice-candidate", {
                target: remoteId,
                candidate: event.candidate
            });
        };

        pc.onconnectionstatechange = () => {
            console.log(
                `Connection ${remoteId}:`,
                pc.connectionState
            );

            if (
                pc.connectionState === "failed" ||
                pc.connectionState === "closed"
            ) {
                removePeerConnection(remoteId);
            }
        };

        return pc;
    }

    // ==========================================
    // CREATE OFFER
    // ==========================================

    async function createOffer(remoteId) {
        try {
            const pc =
                await createPeerConnection(remoteId);

            const offer = await pc.createOffer();

            await pc.setLocalDescription(offer);

            socket.emit("webrtc-offer", {
                target: remoteId,
                offer
            });

            console.log(
                "Offer sent to:",
                remoteId
            );
        } catch (error) {
            console.error(
                "Offer creation failed:",
                error
            );
        }
    }

    // ==========================================
    // REMOVE PEER
    // ==========================================

    function removePeerConnection(remoteId) {
        const pc =
            peerConnectionsRef.current[remoteId];

        if (pc) {
            pc.close();
        }

        delete peerConnectionsRef.current[remoteId];

        setRemoteStreams((prev) => {
            const updated = { ...prev };

            delete updated[remoteId];

            return updated;
        });
    }

    // ==========================================
    // HANDLE GROUP MEMBERS
    // ==========================================

    useEffect(() => {
        if (!group) return;

        if (!socket.id) return;

        const members = group.members;

        members.forEach((member) => {
            // Don't connect to yourself
            if (member.id === socket.id) {
                return;
            }

            /*
             * Only one side creates the offer.
             *
             * This prevents:
             *
             * A -> B offer
             * B -> A offer
             *
             * at the same time.
             */

            if (socket.id < member.id) {
                if (
                    !peerConnectionsRef.current[
                        member.id
                    ]
                ) {
                    createOffer(member.id);
                }
            }
        });

        // Remove connections for players
        // who are no longer in the group

        Object.keys(
            peerConnectionsRef.current
        ).forEach((remoteId) => {
            const stillInGroup = members.some(
                (member) =>
                    member.id === remoteId
            );

            if (!stillInGroup) {
                removePeerConnection(remoteId);
            }
        });
    }, [group]);

    // ==========================================
    // MICROPHONE
    // ==========================================

    async function toggleMicrophone() {
        try {
            // -------------------------------
            // Turn microphone OFF
            // -------------------------------

            if (micOn) {
                if (localStreamRef.current) {
                    localStreamRef.current
                        .getAudioTracks()
                        .forEach((track) => {
                            track.enabled = false;
                        });
                }

                setMicOn(false);

                console.log("Microphone OFF");

                return;
            }

            // -------------------------------
            // Turn microphone ON
            // -------------------------------

            const stream =
                await navigator.mediaDevices.getUserMedia(
                    {
                        audio: true,
                        video: false
                    }
                );

            localStreamRef.current = stream;

            setMicOn(true);

            console.log(
                "Microphone permission granted"
            );

            // Add microphone to existing peers

            for (const remoteId of Object.keys(
                peerConnectionsRef.current
            )) {
                const pc =
                    peerConnectionsRef.current[
                        remoteId
                    ];

                stream
                    .getAudioTracks()
                    .forEach((track) => {
                        pc.addTrack(
                            track,
                            stream
                        );
                    });

                // Renegotiate

                const offer =
                    await pc.createOffer();

                await pc.setLocalDescription(
                    offer
                );

                socket.emit("webrtc-offer", {
                    target: remoteId,
                    offer
                });
            }
        } catch (error) {
            console.error(
                "Microphone error:",
                error
            );

            setError(
                "Microphone permission was denied or unavailable."
            );
        }
    }

    // ==========================================
    // CREATE GROUP
    // ==========================================

    function createGroup() {
        if (!connected) {
            setError("Not connected to server.");
            return;
        }

        const name = username.trim();

        if (!name) {
            setError("Enter your username.");
            return;
        }

        setError("");

        socket.emit("create-group", name);
    }

    // ==========================================
    // JOIN GROUP
    // ==========================================

    function joinGroup() {
        if (!connected) {
            setError("Not connected to server.");
            return;
        }

        const name = username.trim();
        const id = groupInput
            .trim()
            .toUpperCase();

        if (!name) {
            setError("Enter your username.");
            return;
        }

        if (!id) {
            setError("Enter a group ID.");
            return;
        }

        setError("");

        socket.emit("join-group", {
            username: name,
            groupId: id
        });
    }

    // ==========================================
    // LEAVE GROUP
    // ==========================================

    function leaveGroup() {
        // Stop microphone

        if (localStreamRef.current) {
            localStreamRef.current
                .getTracks()
                .forEach((track) => track.stop());

            localStreamRef.current = null;
        }

        // Close all peer connections

        Object.keys(
            peerConnectionsRef.current
        ).forEach((remoteId) => {
            peerConnectionsRef.current[
                remoteId
            ].close();
        });

        peerConnectionsRef.current = {};

        setRemoteStreams({});
        setMicOn(false);

        socket.emit("leave-group");

        setGroup(null);
    }

    // ==========================================
    // LOBBY SCREEN
    // ==========================================

    if (!group) {
        return (
            <div className="app">
                <div className="container">
                    <h1>Discuss Hub Mic Prototype</h1>

                    <p className="subtitle">
                        Create or join a team
                    </p>

                    <div className="connection">
                        {connected
                            ? "🟢 Server Connected"
                            : "🔴 Server Disconnected"}
                    </div>

                    <div className="lobby">

                        <div className="input-group">
                            <label>
                                Username
                            </label>

                            <input
                                value={username}
                                onChange={(e) =>
                                    setUsername(
                                        e.target.value
                                    )
                                }
                                placeholder="Enter username"
                            />
                        </div>

                        <button
                            className="create-btn"
                            onClick={createGroup}
                            disabled={!connected}
                        >
                            + Create Group
                        </button>

                        <div className="divider">
                            OR
                        </div>

                        <div className="input-group">
                            <label>
                                Group ID
                            </label>

                            <input
                                value={groupInput}
                                onChange={(e) =>
                                    setGroupInput(
                                        e.target.value
                                    )
                                }
                                placeholder="GROUP-1234"
                            />
                        </div>

                        <button
                            className="join-btn"
                            onClick={joinGroup}
                            disabled={!connected}
                        >
                            Join Group
                        </button>

                        {error && (
                            <div className="error">
                                {error}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // ==========================================
    // GROUP SCREEN
    // ==========================================

    return (
        <div className="app">
            <div className="container">

                <div className="group-container">

                    <div className="group-header">

                        <div>
                            <p className="group-label">
                                YOUR GROUP
                            </p>

                            <h2>
                                {group.groupId}
                            </h2>
                        </div>

                        <button
                            className="leave-btn"
                            onClick={leaveGroup}
                        >
                            Leave
                        </button>

                    </div>

                    <div className="members">

                        <div className="members-header">

                            <h3>
                                Team
                            </h3>

                            <span>
                                {
                                    group.members.length
                                }{" "}
                                / 4
                            </span>

                        </div>

                        {group.members.map(
                            (member) => {

                                const isLeader =
                                    member.id ===
                                    group.leaderId;

                                const isYou =
                                    member.id ===
                                    socket.id;

                                return (
                                    <div
                                        className="member"
                                        key={member.id}
                                    >

                                        <div className="avatar">
                                            {member.username
                                                .charAt(0)
                                                .toUpperCase()}
                                        </div>

                                        <div className="member-info">

                                            <div className="member-name">

                                                {
                                                    member.username
                                                }

                                                {isYou && (
                                                    <span className="you">
                                                        YOU
                                                    </span>
                                                )}

                                            </div>

                                            {isLeader && (
                                                <span className="leader">
                                                    👑 Team Leader
                                                </span>
                                            )}

                                        </div>

                                        <div className="online">
                                            ●
                                        </div>

                                    </div>
                                );
                            }
                        )}

                    </div>

                    {/* =========================
                        VOICE CHAT
                    ========================= */}

                    <div className="voice-area">

                        <button
                            onClick={
                                toggleMicrophone
                            }
                            className={
                                micOn
                                    ? "mic-btn mic-on"
                                    : "mic-btn"
                            }
                        >
                            {micOn
                                ? "🎙️ Microphone ON"
                                : "🎙️ Turn Microphone ON"}
                        </button>

                        <p>
                            {micOn
                                ? "Your microphone is active"
                                : "Microphone is OFF"}
                        </p>

                    </div>

                    {/* =========================
                        REMOTE AUDIO
                    ========================= */}

                    <div className="remote-audio">

                        {Object.entries(
                            remoteStreams
                        ).map(
                            ([
                                remoteId,
                                stream
                            ]) => (
                                <RemoteAudio
                                    key={remoteId}
                                    stream={stream}
                                    remoteId={remoteId}
                                />
                            )
                        )}

                    </div>

                    {error && (
                        <div className="error">
                            {error}
                        </div>
                    )}

                </div>

            </div>
        </div>
    );
}


// ==============================================
// REMOTE AUDIO COMPONENT
// ==============================================

function RemoteAudio({
    stream,
    remoteId
}) {
    const audioRef = useRef(null);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.srcObject =
                stream;

            audioRef.current
                .play()
                .catch((error) => {
                    console.log(
                        "Audio autoplay blocked:",
                        error
                    );
                });
        }
    }, [stream]);

    return (
        <div className="remote-user">
            <span>
                🔊 Connected:
            </span>

            <span>
                {remoteId.slice(0, 6)}
            </span>

            <audio
                ref={audioRef}
                autoPlay
                playsInline
            />
        </div>
    );
}

export default App;