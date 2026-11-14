const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
// serving the frontend folder from here so no cors / port problems
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 5000;
if (!process.env.MONGODB_URI || !SECRET) {
  throw new Error('MONGODB_URI and JWT_SECRET environment variables are required');
}

// ---------------- database ----------------
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.log('DB error: ' + err.message));

const userSchema = new mongoose.Schema({
  name: String,
  role: { type: String, enum: ['admin', 'student', 'driver'] },
  email: { type: String, unique: true },
  password: String,
  contact: String,
  address: String
});

const busSchema = new mongoose.Schema({
  busNumber: String,
  capacity: Number,
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, default: 'Active' }, // Active / Maintenance
  currentStop: { type: String, default: '' },
  tripStatus: { type: String, default: 'Not Started' } // Not Started / Started / En Route / Reached Destination
});

const routeSchema = new mongoose.Schema({
  routeName: String,
  stops: [String],
  timings: [String],
  busId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bus' },
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, default: 'Running' } // Running / Delayed / Maintenance
});

const allocationSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  routeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Route' },
  assignedStop: String,
  createdAt: { type: Date, default: Date.now }
});

const logSchema = new mongoose.Schema({
  busId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bus' },
  timestamp: { type: Date, default: Date.now },
  currentStop: String,
  nextStop: String,
  remarks: String
});

const User = mongoose.model('User', userSchema);
const Bus = mongoose.model('Bus', busSchema);
const Route = mongoose.model('Route', routeSchema);
const Allocation = mongoose.model('Allocation', allocationSchema);
const LocationLog = mongoose.model('LocationLog', logSchema);

// ---------------- middleware ----------------
function checkLogin(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ message: 'Please login first' });
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (e) {
    res.status(401).json({ message: 'Invalid token' });
  }
}

function onlyRoles(...roles) {
  return function (req, res, next) {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Not allowed for ' + req.user.role });
    }
    next();
  };
}

// ---------------- auth ----------------
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, contact, address } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'Fill all required fields' });
    }
    if (role === 'admin') {
      return res.status(403).json({ message: 'Admin accounts must be created by the transport manager' });
    }
    const old = await User.findOne({ email });
    if (old) return res.status(400).json({ message: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 10);
    await User.create({ name, email, password: hashed, role, contact, address });
    res.json({ message: 'Registered successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'User not found' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ message: 'Wrong password' });

    const token = jwt.sign({ id: user._id, role: user.role, name: user.name }, SECRET, { expiresIn: '1d' });
    res.json({ token, user: { id: user._id, name: user.name, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------- buses ----------------
app.post('/api/buses', checkLogin, onlyRoles('admin'), async (req, res) => {
  try {
    const { busNumber, capacity, driverId } = req.body;
    if (!busNumber || !capacity) return res.status(400).json({ message: 'Bus number and capacity needed' });
    const bus = await Bus.create({ busNumber, capacity, driverId: driverId || null });
    res.json(bus);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/buses', checkLogin, onlyRoles('admin'), async (req, res) => {
  const buses = await Bus.find().populate('driverId', 'name contact');
  res.json(buses);
});

// simulated location update, driver clicks buttons and bus moves to next stop
app.put('/api/buses/:id/location', checkLogin, onlyRoles('driver', 'admin'), async (req, res) => {
  try {
    const bus = await Bus.findById(req.params.id);
    if (!bus) return res.status(404).json({ message: 'Bus not found' });

    // driver can only move his own bus
    if (req.user.role === 'driver' && String(bus.driverId) !== req.user.id) {
      return res.status(403).json({ message: 'This is not your bus' });
    }

    const route = await Route.findOne({ busId: bus._id });
    if (!route) return res.status(400).json({ message: 'No route assigned to this bus' });

    const action = req.body.action;
    let remarks = '';

    if (action === 'start') {
      bus.currentStop = route.stops[0];
      bus.tripStatus = 'Started';
      remarks = 'Bus departed from ' + route.stops[0];
    } else if (action === 'next') {
      if (bus.tripStatus === 'Not Started' || bus.tripStatus === 'Reached Destination') {
        return res.status(400).json({ message: 'Start the trip first' });
      }
      let nextStopIndex = route.stops.indexOf(bus.currentStop) + 1;
      if (nextStopIndex < route.stops.length) {
        bus.currentStop = route.stops[nextStopIndex];
        bus.tripStatus = 'En Route';
        remarks = 'Bus reached ' + bus.currentStop;
      } else {
        bus.tripStatus = 'Reached Destination';
        remarks = 'Bus reached destination';
      }
    } else if (action === 'end') {
      bus.tripStatus = 'Reached Destination';
      remarks = 'Trip ended';
    } else {
      return res.status(400).json({ message: 'Unknown action' });
    }

    await bus.save();

    const idx = route.stops.indexOf(bus.currentStop);
    await LocationLog.create({
      busId: bus._id,
      currentStop: bus.currentStop,
      nextStop: route.stops[idx + 1] || 'END',
      remarks: remarks
    });

    res.json({ message: remarks, bus });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// students see this -> "Bus is 3 stops away"
app.get('/api/buses/:id/status', checkLogin, async (req, res) => {
  try {
    const bus = await Bus.findById(req.params.id);
    if (!bus) return res.status(404).json({ message: 'Bus not found' });
    const route = await Route.findOne({ busId: bus._id });

    let message = '';
    let eta = null;

    if (bus.tripStatus === 'Not Started') {
      message = 'Bus has not started yet';
    } else if (bus.tripStatus === 'Reached Destination') {
      message = 'Bus reached the destination';
    } else {
      message = 'Bus is currently at ' + bus.currentStop + '.';
      if (req.user.role === 'student' && route) {
        const alloc = await Allocation.findOne({ studentId: req.user.id });
        if (alloc) {
          const diff = route.stops.indexOf(alloc.assignedStop) - route.stops.indexOf(bus.currentStop);
          if (diff > 0) {
            message += ' Bus is ' + diff + ' stop(s) away from your stop.';
            eta = diff * 5; // assuming 5 min between stops
          } else if (diff === 0) {
            message += ' Bus reached your stop.';
            eta = 0;
          } else {
            message += ' Bus already passed your stop.';
          }
        }
      }
    }

    res.json({
      busNumber: bus.busNumber,
      currentStop: bus.currentStop,
      tripStatus: bus.tripStatus,
      routeStatus: route ? route.status : 'N/A',
      message: message,
      eta: eta
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------- routes ----------------
app.post('/api/routes', checkLogin, onlyRoles('admin'), async (req, res) => {
  try {
    const { routeName, stops, timings, busId } = req.body;
    if (!routeName || !stops || stops.length < 2) {
      return res.status(400).json({ message: 'Route name and at least 2 stops needed' });
    }
    const bus = await Bus.findById(busId);
    if (!bus) return res.status(400).json({ message: 'Select a valid bus' });

    const route = await Route.create({
      routeName,
      stops,
      timings: timings || [],
      busId: bus._id,
      driverId: bus.driverId
    });
    res.json(route);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/routes', checkLogin, async (req, res) => {
  const routes = await Route.find().populate('busId', 'busNumber').populate('driverId', 'name');
  res.json(routes);
});

app.put('/api/routes/:id/status', checkLogin, onlyRoles('admin'), async (req, res) => {
  const allowed = ['Running', 'Delayed', 'Maintenance'];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ message: 'Bad status' });
  const route = await Route.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
  res.json(route);
});

app.post('/api/routes/assign', checkLogin, onlyRoles('admin'), async (req, res) => {
  try {
    const { studentId, routeId, assignedStop } = req.body;
    const student = await User.findById(studentId);
    const route = await Route.findById(routeId);
    if (!student || !route) return res.status(404).json({ message: 'Student or route not found' });

    let stop = assignedStop;
    if (!stop) {
      // auto allocate: check if any stop name is in student's address
      const address = (student.address || '').toLowerCase();
      stop = route.stops.find((s) => address.includes(s.toLowerCase()));
      if (!stop) return res.status(400).json({ message: 'Could not match address with any stop, choose stop manually' });
    }
    if (!route.stops.includes(stop)) return res.status(400).json({ message: 'Stop is not in this route' });

    const old = await Allocation.findOne({ studentId });
    if (old) {
      old.routeId = routeId;
      old.assignedStop = stop;
      await old.save();
    } else {
      await Allocation.create({ studentId, routeId, assignedStop: stop });
    }
    res.json({ message: student.name + ' assigned to ' + route.routeName + ' (' + stop + ')' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// driver's own route
app.get('/api/routes/driver/me', checkLogin, onlyRoles('driver'), async (req, res) => {
  const route = await Route.findOne({ driverId: req.user.id }).populate('busId');
  if (!route) return res.status(404).json({ message: 'No route assigned to you yet' });
  res.json(route);
});

// student's route
app.get('/api/routes/student/:studentId', checkLogin, onlyRoles('student'), async (req, res) => {
  try {
    if (req.params.studentId !== req.user.id) {
      return res.status(403).json({ message: 'You can see only your route' });
    }
    const alloc = await Allocation.findOne({ studentId: req.params.studentId });
    if (!alloc) return res.status(404).json({ message: 'No route allocated yet, contact transport manager' });

    const route = await Route.findById(alloc.routeId).populate('busId').populate('driverId', 'name contact');
    res.json({
      routeName: route.routeName,
      stops: route.stops,
      timings: route.timings,
      routeStatus: route.status,
      assignedStop: alloc.assignedStop,
      busId: route.busId ? route.busId._id : null,
      busNumber: route.busId ? route.busId.busNumber : '-',
      driverName: route.driverId ? route.driverId.name : 'Not assigned',
      driverContact: route.driverId ? route.driverId.contact : '-'
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------- admin ----------------
app.get('/api/admin/summary', checkLogin, onlyRoles('admin'), async (req, res) => {
  const totalBuses = await Bus.countDocuments();
  const activeRoutes = await Route.countDocuments({ status: 'Running' });
  const studentsAllocated = await Allocation.countDocuments();
  const busesEnRoute = await Bus.countDocuments({ tripStatus: { $in: ['Started', 'En Route'] } });
  res.json({ totalBuses, activeRoutes, studentsAllocated, busesEnRoute });
});

// used to fill the dropdowns
app.get('/api/admin/users/:role', checkLogin, onlyRoles('admin'), async (req, res) => {
  const users = await User.find({ role: req.params.role }).select('name email address');
  res.json(users);
});

app.listen(PORT, '0.0.0.0', () => console.log('Server listening on port ' + PORT));
