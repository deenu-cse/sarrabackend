import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import USER_ROLES, { WORKFLOW_ROLES } from '../constants/roles.constants.js';
import { DISTRICTS } from '../constants/districts.constants.js';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a name'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Please provide a password'],
      minlength: 8,
      select: false,
    },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      required: true,
    },
    workflowRole: {
      type: String,
      enum: [...Object.values(WORKFLOW_ROLES), null],
      default: null,
    },
    district: {
      type: String,
      enum: [...DISTRICTS, null],
      required: function () {
        return this.role === USER_ROLES.PIA_OFFICER || this.role === USER_ROLES.DD_LEVEL;
      },
    },
    department: {
      type: String,
      required: function () {
        return this.role === USER_ROLES.PIA_OFFICER;
      },
    },
    employeeId: {
      type: String,
      unique: true,
      sparse: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    designation: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    accountStatus: {
      type: String,
      enum: ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'],
      default: 'ACTIVE',
    },
    suspendedUntil: Date,
    suspensionReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    deactivatedAt: Date,
    deactivationReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    statusChangedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    statusChangedAt: Date,
    passwordChangedAt: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
    invitePending: {
      type: Boolean,
      default: false,
    },
    inviteOtpHash: String,
    inviteOtpExpires: Date,
    invitedAt: Date,
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    lastLogin: Date,
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: Date,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, Number(process.env.BCRYPT_ROUNDS) || 12);
  if (!this.isNew) {
    this.passwordChangedAt = Date.now() - 1000;
  }
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.isAccountLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

/**
 * Sync isActive with accountStatus. Auto-lifts expired suspensions.
 * @returns {{ status: string, lifted?: boolean }}
 */
userSchema.methods.resolveAccountAccess = async function () {
  if (
    this.accountStatus === 'SUSPENDED' &&
    this.suspendedUntil &&
    this.suspendedUntil <= new Date()
  ) {
    this.accountStatus = 'ACTIVE';
    this.isActive = true;
    this.suspendedUntil = undefined;
    this.suspensionReason = undefined;
    this.statusChangedAt = new Date();
    await this.save({ validateBeforeSave: false });
    return { status: 'ACTIVE', lifted: true };
  }

  // Backfill older records that only used isActive
  if (!this.accountStatus) {
    this.accountStatus = this.isActive === false ? 'DEACTIVATED' : 'ACTIVE';
  }

  if (this.accountStatus === 'ACTIVE' && this.isActive === false) {
    this.isActive = true;
    await this.save({ validateBeforeSave: false });
  }

  return { status: this.accountStatus || (this.isActive ? 'ACTIVE' : 'DEACTIVATED') };
};

userSchema.methods.getRestrictionPayload = function () {
  return {
    accountStatus: this.accountStatus,
    name: this.name,
    email: this.email,
    suspendedUntil: this.suspendedUntil || null,
    suspensionReason: this.suspensionReason || null,
    deactivatedAt: this.deactivatedAt || null,
    deactivationReason: this.deactivationReason || null,
    statusChangedAt: this.statusChangedAt || null,
  };
};

userSchema.methods.incrementLoginAttempts = async function () {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    this.loginAttempts = 1;
    this.lockUntil = undefined;
    return this.save({ validateBeforeSave: false });
  }

  this.loginAttempts += 1;
  if (this.loginAttempts >= 5) {
    this.lockUntil = Date.now() + 30 * 60 * 1000;
  }
  return this.save({ validateBeforeSave: false });
};

userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

const User = mongoose.model('User', userSchema);
export default User;
