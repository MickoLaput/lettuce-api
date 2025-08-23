require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes  = require('./routes/auth');
const forumRoutes = require('./routes/forum');
const usersRoutes = require('./routes/users');   

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/forum', forumRoutes);
app.use('/api', usersRoutes);                   

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on ${PORT}`));
