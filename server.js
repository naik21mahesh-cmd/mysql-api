const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const socketIo = require('socket.io');

const app = express();
app.use(express.json());
app.use(cors());
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});



// Configure the MySQL connection
const db = mysql.createConnection({
  host: 'srv1113.hstgr.io', // Your MySQL host
  user: 'u872433678_foodcart', // Your MySQL username
  password: '5DfT:uvf17=', // Your MySQL password
  database: 'u872433678_foodcart', // Your database name
  connectTimeout: 60000, // Increase timeout to 60 seconds to handle slow remote connections
  
});

// Connect to the database
db.connect(err => {
  if (err) {
    console.error('Error connecting to the database:', err);
    return;
  }
  console.log('Connected to the MySQL database.');
});

// Login User
app.post('/api/login', async (req, res) => {
  try {
    const {
      username,
      password
    } = req.body;
    const [users] = await db.promise().query('SELECT users.*, user_roles.role_id, user_permissions.assigned_devices FROM users LEFT JOIN user_roles ON users.id = user_roles.user_id LEFT JOIN user_permissions ON users.id = user_permissions.user_id WHERE username = ?', [username]);
    if (users.length === 0) {
      return res.status(401).json({
        message: 'Invalid credentials'
      });
    }
    const user = users[0];
    // const isMatch = await bcrypt.compare(password, user.password);
    const isMatch = password === user.password;
    if (!isMatch) {
      return res.status(401).json({
        message: 'Invalid credentials'
      });
    }
    const token = jwt.sign({
      id: user.id
    }, process.env.JWT_SECRET || 'secretkey', {
      expiresIn: '1h'
    });
    res.json({
      token,
      user: {
        id: user.id,
        password: user.password,
        username: user.username,
        email: user.email,
        role_id: user.role_id,
        assigned_devices: user.assigned_devices
      }
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Define an API endpoint to get users
app.get('/api/users', (req, res) => {
  const sql = `SELECT 
    users.*, roles.name AS role_name, user_roles.role_id, user_permissions.assigned_devices
  FROM users 
    LEFT JOIN user_roles 
      ON users.id = user_roles.user_id
    LEFT JOIN roles 
      ON user_roles.role_id = roles.id
    LEFT JOIN user_permissions 
      ON users.id = user_permissions.user_id
    ORDER BY user_roles.role_id`;
  db.query(sql, (err, results) => {
    if (err) {
      res.status(500).send(err);
      return;
    }
    res.json(results); // Send data as JSON
  });
});

// Define an API endpoint to get logs
app.get('/api/getLogs', (req, res) => {
  const {
    assigned_devices,
    startDate,
    endDate
  } = req.query;
  let sql = 'SELECT * FROM daily_logs';
  let queryParams = [];
  let conditions = [];

  if (assigned_devices) {
    let devices = [];
    if (Array.isArray(assigned_devices)) {
      devices = assigned_devices;
    } else {
      try {
        devices = JSON.parse(assigned_devices);
        if (!Array.isArray(devices)) {
          devices = [devices];
        }
      } catch (e) {
        devices = [assigned_devices];
      }
    }

    if (devices.length > 0) {
      const placeholders = devices.map(() => '?').join(', ');
      conditions.push(`JSON_UNQUOTE(JSON_EXTRACT(values_json, '$[0]')) IN (${placeholders}) `);
      queryParams.push(...devices);
    }
  }

  if (startDate) {
    conditions.push('log_datetime >= ? ');
    queryParams.push(`${startDate} 00:00:00`);
  }

  if (endDate) {
    conditions.push('log_datetime <= ? ');
    queryParams.push(`${endDate} 23:59:59`);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY log_datetime DESC ';
  db.query(sql, queryParams, (err, results) => {
  if (err) {
    console.error("SQL ERROR:", err);  // add this
    return res.status(500).json(err);
  }
  res.json(results);
});

});

// Define an API endpoint to get unique device details from daily_logs
app.get('/api/getDevices', (req, res) => {
  const sql = "SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(values_json, '$[0]')) AS device_id FROM daily_logs WHERE JSON_EXTRACT(values_json, '$[0]') IS NOT NULL";
  db.query(sql, (err, results) => {
    if (err) {
      res.status(500).send(err);
      return;
    }
    res.json(results);
  });
});

// Save user permissions
app.post('/api/saveUserPermissions', async (req, res) => {
  try {
    const {
      user_id,
      assigned_devices,
      updated_by
    } = req.body;

    const [existing] = await db.promise().query('SELECT id FROM user_permissions WHERE user_id = ?', [user_id]);

    if (existing.length > 0) {
      await db.promise().query('UPDATE user_permissions SET assigned_devices = ?, updated_by = ?, updated_on = NOW() WHERE user_id = ?', [JSON.stringify(assigned_devices), updated_by, user_id]);
    } else {
      await db.promise().query('INSERT INTO user_permissions (user_id, assigned_devices, updated_by, updated_on) VALUES (?, ?, ?, NOW())', [user_id, JSON.stringify(assigned_devices), updated_by]);
    }

    res.status(200).json({
      message: 'Permissions saved successfully'
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Add log
app.post('/api/addLog', async (req, res) => {
  try {
    const {
      values_json
    } = req.body;
    const sql = 'INSERT INTO daily_logs (log_datetime, values_json) VALUES (NOW(), ?)';
    await db.promise().query(sql, [JSON.stringify(values_json)]);
    res.status(201).json({
      message: 'Log added successfully'
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Define an API endpoint to get user roles
app.get('/api/getUserRoles', (req, res) => {
  const sql = 'SELECT * FROM roles';
  db.query(sql, (err, results) => {
    if (err) {
      res.status(500).send(err);
      return;
    }
    res.json(results);
  });
});

// Define an API endpoint to Add/edit user
app.post('/api/addEditUser', async (req, res) => {
  try {
    const {
      id,
      username,
      email,
      password,
      is_active,
      role_id
    } = req.body;

    if (id) {
      const [users] = await db.promise().query('SELECT * FROM users WHERE username = ? AND id != ?', [username, id]);
      if (users.length > 0) {
        return res.status(409).json({
          message: 'User with selected username already exists'
        });
      }

      if (password) {
        const sql = 'UPDATE users SET email = ?, password = ?, is_active = ? WHERE id = ?';
        await db.promise().query(sql, [email, password, is_active, id]);
      } else {
        const sql = 'UPDATE users SET email = ?, is_active = ? WHERE id = ?';
        await db.promise().query(sql, [email, is_active, id]);
      }

      const [usersRoles] = await db.promise().query('SELECT * FROM user_roles WHERE user_id = ?', [id]);
      // Insert user roles 
      if (usersRoles.length > 0) {
        const roleSql = 'UPDATE user_roles SET role_id = ? WHERE user_id = ?';
        await db.promise().query(roleSql, [role_id, id]);
      } else {
        const roleSql = 'INSERT INTO user_roles (role_id, user_id) VALUES (?, ?)';
        await db.promise().query(roleSql, [role_id, id]);
      }

      res.status(200).json({
        message: 'User updated successfully'
      });
    } else {
      const [users] = await db.promise().query('SELECT * FROM users WHERE username = ?', [username]);
      if (users.length > 0) {
        return res.status(409).json({
          message: 'User with selected username already exists'
        });
      }

      const sql = 'INSERT INTO users (username, email, password, is_active) VALUES (?, ?, ?, ?)';
      const [result] = await db.promise().query(sql, [username, email, password, is_active]);
      const newUserID = result.insertId;

      // Insert user roles 
      const roleSql = 'INSERT INTO user_roles (role_id, user_id) VALUES (?, ?)';
      await db.promise().query(roleSql, [role_id, newUserID]);

      res.status(201).json({
        message: 'User created successfully'
      });
    }
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Delete user
app.delete('/api/deleteUser/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await db.promise().query('DELETE FROM user_roles WHERE user_id = ?', [id]);
    await db.promise().query('DELETE FROM users WHERE id = ?', [id]);

    res.json({
      message: 'User deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Test endpoint
app.get('/api/putDevice', async (req, res) => {
  try {
    res.json("DMS-001, 32.9Deg C, 228.43V, 254.65V, 250.41V, 14.71A, 14.12A, 0.27A, 20min ON, Mains Supply; WiFi connected; TE on Manual Mode;, , , , ,");
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Serve the device form HTML page
app.get('/device', (req, res) => {
  res.sendFile(path.join(__dirname, 'device_form.html'));
});

// Submit device string
app.post('/api/putDevice', async (req, res) => {
  try {
    const {
      device_string
    } = req.body;
    if (!device_string) {
      return res.status(400).json({
        message: 'device_string is required'
      });
    }

    // Split the string by comma to create the values array expected by daily_logs
    const values = device_string.split(',').map(v => v.trim());
    const sql = 'INSERT INTO daily_logs (log_datetime, values_json) VALUES (NOW(), ?)';
    await db.promise().query(sql, [JSON.stringify(values)]);

    if (global.io) {
      global.io.emit('device_data_updated');
    }

    res.status(201).json({
      message: 'Device data saved successfully'
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});
 

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
global.io = io;
