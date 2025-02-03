const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();

// Configure CORS with specific options
app.use(cors({
    origin: ['https://frontend-production-7549.up.railway.app'], // Add your frontend URLs
    methods: ['GET', 'POST'],
    credentials: true
}));
app.use(express.json());

const users = [];
const friendRequests = {};
const friends = {};
const activeUsers = {};
const messages = {};

// Helper function to format date
function formatDate() {
    return new Date().toISOString();
}

// Validation functions
const validateEmail = email => /^[^\s@]+@gmail\.com$/.test(email);
const validatePassword = password => /(?=.*[A-Z])(?=.*\d)(?=.*[@#$%^&+=]).{8,}/.test(password);
const validatePhone = phone => /^\d{10}$/.test(phone);
const validateUsername = username => username.length >= 3 && username.length <= 30;

// Single signup route with improved error handling
app.post('/api/signup', async (req, res) => {
    console.log('Received signup request:', req.body);

    try {
        const { email, password, username, phone } = req.body;

        // Validation checks
        if (!email || !password || !username || !phone) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        if (!validateEmail(email)) {
            return res.status(400).json({ error: 'Email must end with @gmail.com' });
        }

        if (!validatePassword(password)) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long and contain at least one uppercase letter, one number, and one special character' });
        }

        if (!validatePhone(phone)) {
            return res.status(400).json({ error: 'Phone number must be 10 digits' });
        }

        if (!validateUsername(username)) {
            return res.status(400).json({ error: 'Username must be between 3 and 30 characters' });
        }

        // Check for existing user
        const existingUser = users.find(user =>
            user.email === email || user.username === username || user.phone === phone
        );

        if (existingUser) {
            let error = 'User already exists';
            if (existingUser.email === email) {
                error = 'Email already registered';
            } else if (existingUser.username === username) {
                error = 'Username already taken';
            } else if (existingUser.phone === phone) {
                error = 'Phone number already registered';
            }
            return res.status(400).json({ error });
        }

        // Create new user
        const newUser = {
            email,
            password,
            username,
            phone,
            status: 'offline',
            createdAt: formatDate()
        };

        users.push(newUser);

        // Initialize empty arrays for the new user
        friends[username] = [];
        friendRequests[username] = [];

        console.log('User registered successfully:', username);

        res.status(201).json({
            message: 'User registered successfully',
            username: newUser.username
        });

    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({
            error: 'Internal server error during signup'
        });
    }
});

app.post('/api/login', (req, res) => {
    const { loginContact, loginPassword } = req.body;
    console.log('Login attempt with:', loginContact);

    const user = users.find(
        (u) =>
            (u.email === loginContact || u.username === loginContact || u.phone === loginContact) &&
            u.password === loginPassword
    );

    if (!user) {
        return res.status(401).json({ error: 'Invalid login credentials' });
    }

    user.status = 'online';
    console.log('User logged in successfully:', user.username);
    res.json({ user });
});

app.post('/api/logout', (req, res) => {
    const { username } = req.body;
    console.log('Logout attempt by:', username);

    const user = users.find(u => u.username === username);

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    user.status = 'offline';
    console.log('User logged out successfully:', user.username);
    res.json({ message: 'User logged out successfully' });
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: ['https://frontend-production-7549.up.railway.app'], // Add your frontend URLs
        methods: ['GET', 'POST'],
        credentials: true
    }
});

io.on('connection', (socket) => {
    console.log('A user connected.');

    socket.on('userConnected', (username) => {
        activeUsers[username] = {
            socketId: socket.id,
            status: 'online',
            lastSeen: formatDate()
        };
        console.log(`${username} connected.`);

        // Send any pending messages
        if (messages[username]) {
            io.to(socket.id).emit('pendingMessages', messages[username]);
            delete messages[username];
        }
    });

    socket.on('joinRoom', (room) => {
        socket.join(room);
    });

    socket.on('sendMessage', (data) => {
        const messageData = {
            ...data,
            timestamp: formatDate()
        };

        const { room, message, sender } = messageData;
        const [user1, user2] = room.split('-');
        const receiver = user1 === sender ? user2 : user1;

        // Store message
        if (!messages[room]) {
            messages[room] = [];
        }
        messages[room].push(messageData);

        // Send to room
        io.to(room).emit(`receiveMessage-${room}`, messageData);

        // Handle offline user messages
        if (!activeUsers[receiver]) {
            if (!messages[receiver]) {
                messages[receiver] = [];
            }
            messages[receiver].push(messageData);
        } else {
            // Send notification to online user
            const receiverSocketId = activeUsers[receiver].socketId;
            if (receiverSocketId) {
                io.to(receiverSocketId).emit('messageNotification', { from: sender });
            }
        }
    });

    socket.on('getChatHistory', (room, callback) => {
        const roomMessages = messages[room] || [];
        callback(roomMessages);
    });

    socket.on('sendFriendRequest', ({ from, to }) => {
        console.log(`Friend request received from ${from} to ${to}`);
        if (!friendRequests[to]) {
            friendRequests[to] = [];
        }

        // Check if a friend request is already sent or if they are already friends
        if (!friendRequests[to].includes(from) && !friends[to]?.includes(from) && !friends[from]?.includes(to)) {
            friendRequests[to].push(from);
            console.log(`Friend request sent from ${from} to ${to}`);
            const toSocketId = activeUsers[to]?.socketId;
            if (toSocketId) {
                io.to(toSocketId).emit('friendRequestReceived', { from });
            }
        } else {
            console.log(`Friend request from ${from} to ${to} was not sent (already friends or request already sent)`);
        }
    });

    socket.on('acceptFriendRequest', ({ from, to }) => {
        friends[to] = friends[to] || [];
        friends[from] = friends[from] || [];

        friends[to].push(from);
        friends[from].push(to);
        friendRequests[to] = friendRequests[to].filter(request => request !== from);

        const fromSocketId = activeUsers[from]?.socketId;
        const toSocketId = activeUsers[to]?.socketId;

        if (fromSocketId) {
            io.to(fromSocketId).emit('friendRequestAccepted', { from: to });
            io.to(fromSocketId).emit('friendListUpdated');
        }
        if (toSocketId) {
            io.to(toSocketId).emit('friendListUpdated');
        }
    });

    socket.on('unfriend', ({ from, to }) => {
        friends[from] = friends[from]?.filter(friend => friend !== to) || [];
        friends[to] = friends[to]?.filter(friend => friend !== from) || [];

        const fromSocketId = activeUsers[from]?.socketId;
        const toSocketId = activeUsers[to]?.socketId;

        // Emit the friendListUpdated event to both users
        if (fromSocketId) {
            io.to(fromSocketId).emit('friendListUpdated');
        }
        if (toSocketId) {
            io.to(toSocketId).emit('friendListUpdated');
        }
    });

    socket.on('searchUsers', (query) => {
        const results = users
            .filter(user => user.username.toLowerCase().includes(query.toLowerCase()))
            .map(user => ({
                username: user.username,
                status: activeUsers[user.username]?.status || 'offline',
                isFriend: (friends[query] || []).includes(user.username)
            }));
        socket.emit('searchResults', results);
    });

    socket.on('getUserFriends', ({ username }, callback) => {
        const userFriends = friends[username] || [];
        const friendDetails = userFriends.map(friend => {
            const user = users.find(u => u.username === friend);
            return {
                username: friend,
                status: activeUsers[friend]?.status || 'offline'
            };
        });
        callback(friendDetails);
    });

    socket.on('disconnect', () => {
        const disconnectedUser = Object.keys(activeUsers).find(
            (user) => activeUsers[user].socketId === socket.id
        );

        if (disconnectedUser) {
            activeUsers[disconnectedUser].status = 'offline';
            activeUsers[disconnectedUser].lastSeen = formatDate();
            console.log(`${disconnectedUser} disconnected.`);

            // Notify friends about status change
            if (friends[disconnectedUser]) {
                friends[disconnectedUser].forEach(friend => {
                    const friendSocketId = activeUsers[friend]?.socketId;
                    if (friendSocketId) {
                        io.to(friendSocketId).emit('friendListUpdated');
                    }
                });
            }
        }
    });
});

server.listen(5000, () => {
    console.log('Server is running on port 5000');
});