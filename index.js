const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();

mongoose.connect('mongodb://localhost:27017/occulta', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('connected to MongoDB');
})
.catch(err => {
  console.error('shit happened to MongoDB:', err);
});

app.use(express.static(path.join(__dirname, 'public')));







const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server works on ${PORT}`);
});
