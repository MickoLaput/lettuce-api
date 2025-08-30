require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes  = require('./routes/auth');
const forumRoutes = require('./routes/forum');
const usersRoutes = require('./routes/users');
const treatmentsRoutes = require('./routes/treatments'); 
const diagnosesRoutes = require('./routes/diagnoses');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/forum', forumRoutes);
app.use('/api', usersRoutes);
app.use('/api', treatmentsRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); 
app.use('/api', diagnosesRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on ${PORT}`));
