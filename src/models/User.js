
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const savedPropertySchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
    },

    title: {
      type: String,
      default: 'Property Listing',
    },

    location: {
      type: String,
      default: 'Location unavailable',
    },

    city: {
      type: String,
      default: '',
    },

    type: {
      type: String,
      default: 'House',
    },

    price: {
      type: String,
      default: 'Price unavailable',
    },

    bedrooms: {
      type: Number,
      default: 0,
    },

    bathrooms: {
      type: Number,
      default: 0,
    },

    area: {
      type: String,
      default: 'N/A',
    },

    image: {
      type: String,
      default: '',
    },

    imageUrl: {
      type: String,
      default: '',
    },

    sourceUrl: {
      type: String,
      default: '',
    },
  },
  {
    _id: false,
  }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },

    password: {
      type: String,
      required: true,
    },

    savedProperties: {
      type: [savedPropertySchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
userSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);

  this.password = await bcrypt.hash(
    this.password,
    salt
  );
});

userSchema.methods.matchPassword = async function (
  enteredPassword
) {
  return await bcrypt.compare(
    enteredPassword,
    this.password
  );
};

export default mongoose.model('User', userSchema);
