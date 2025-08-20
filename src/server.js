require('dotenv').config();
const express = require('express');
const cors = require('cors');
const forumRoutes = require('./routes/forum');


const authRoutes = require('./routes/auth');

const app = express();

// Allow your app to call this API
app.use(cors());             // in production, pass { origin: 'https://yourapp' }
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);

app.use('/api/forum', forumRoutes);

// Render provides PORT via env
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on ${PORT}`));
