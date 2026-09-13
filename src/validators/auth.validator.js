import Joi from 'joi';
import USER_ROLES from '../constants/roles.constants.js';
import { DISTRICTS } from '../constants/districts.constants.js';
import { DEPARTMENTS } from '../constants/departments.constants.js';

export const registerSchema = Joi.object({
  name: Joi.string().trim().required(),
  email: Joi.string().email().trim().required(),
  password: Joi.string().min(8),
  role: Joi.string().valid(...Object.values(USER_ROLES)).required(),
  district: Joi.string().valid(...DISTRICTS).when('role', {
    is: Joi.string().valid(USER_ROLES.PIA_OFFICER, USER_ROLES.DD_LEVEL),
    then: Joi.required(),
    otherwise: Joi.optional().allow(null, '')
  }),
  department: Joi.string().valid(...DEPARTMENTS).when('role', {
    is: USER_ROLES.PIA_OFFICER,
    then: Joi.required(),
    otherwise: Joi.optional().allow(null, '')
  }),
  employeeId: Joi.string().optional().allow(''),
  phone: Joi.string().optional().allow(''),
  designation: Joi.string().optional().allow('')
});

export const loginSchema = Joi.object({
  email: Joi.string().email().trim().required(),
  password: Joi.string().required()
});

export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(8).required()
});

export const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().trim().required()
});

export const verifyResetOtpSchema = Joi.object({
  email: Joi.string().email().trim().required(),
  otp: Joi.string().length(6).pattern(/^\d+$/).required()
});

export const resetPasswordSchema = Joi.object({
  email: Joi.string().email().trim().required(),
  otp: Joi.string().length(6).pattern(/^\d+$/).required(),
  newPassword: Joi.string().min(8).required()
});

export const inviteUserSchema = Joi.object({
  name: Joi.string().trim().required(),
  email: Joi.string().email().trim().required(),
  role: Joi.string().valid(...Object.values(USER_ROLES)).required(),
  district: Joi.string().valid(...DISTRICTS).when('role', {
    is: Joi.string().valid(USER_ROLES.PIA_OFFICER, USER_ROLES.DD_LEVEL),
    then: Joi.required(),
    otherwise: Joi.optional().allow(null, '')
  }),
  department: Joi.string().valid(...DEPARTMENTS).when('role', {
    is: USER_ROLES.PIA_OFFICER,
    then: Joi.required(),
    otherwise: Joi.optional().allow(null, '')
  }),
  employeeId: Joi.string().optional().allow(''),
  phone: Joi.string().optional().allow(''),
  designation: Joi.string().optional().allow(''),
  workflowRole: Joi.string().valid('MAKER', 'CHECKER', 'APPROVER').optional().allow(null, '')
});

export const verifyInviteOtpSchema = Joi.object({
  email: Joi.string().email().trim().required(),
  otp: Joi.string().length(6).pattern(/^\d+$/).required()
});

export const acceptInviteSchema = Joi.object({
  email: Joi.string().email().trim().required(),
  otp: Joi.string().length(6).pattern(/^\d+$/).required(),
  password: Joi.string().min(8).required()
});

export const suspendUserSchema = Joi.object({
  until: Joi.date().greater('now').required().messages({
    'date.greater': 'Suspend until date must be in the future',
    'any.required': 'Suspend until date is required'
  }),
  reason: Joi.string().trim().max(500).allow('', null)
});

export const deactivateUserSchema = Joi.object({
  reason: Joi.string().trim().max(500).allow('', null)
});
