import Joi from 'joi';
import USER_ROLES from '../constants/roles.constants.js';
import { DISTRICTS } from '../constants/districts.constants.js';

/**
 * Every District and PIA account is a Maker, Checker or Approver of its tier.
 * An HQ account may be one too, or (without a role) an HQ administrator.
 * M&E accounts take no workflow role.
 */
const WORKFLOW_ROLE = Joi.string().valid('MAKER', 'CHECKER', 'APPROVER');
const workflowRoleRule = Joi.any().when('role', {
  switch: [
    { is: Joi.string().valid(USER_ROLES.PIA_OFFICER, USER_ROLES.DD_LEVEL), then: WORKFLOW_ROLE.required().messages({ 'any.required': 'Select the workflow role (Maker, Checker or Approver) of this District or PIA account' }) },
    { is: USER_ROLES.SUPER_ADMIN, then: WORKFLOW_ROLE.optional().allow(null, '') },
  ],
  otherwise: Joi.any().valid(null, '').optional().messages({ 'any.only': 'M&E accounts take no workflow role' }),
});

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
  department: Joi.string().trim().max(80).when('role', {
    is: USER_ROLES.PIA_OFFICER,
    then: Joi.required(),
    otherwise: Joi.optional().allow(null, '')
  }),
  employeeId: Joi.string().optional().allow(''),
  phone: Joi.string().optional().allow(''),
  designation: Joi.string().optional().allow(''),
  workflowRole: workflowRoleRule
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
  department: Joi.string().trim().max(80).when('role', {
    is: USER_ROLES.PIA_OFFICER,
    then: Joi.required(),
    otherwise: Joi.optional().allow(null, '')
  }),
  employeeId: Joi.string().optional().allow(''),
  phone: Joi.string().optional().allow(''),
  designation: Joi.string().optional().allow(''),
  workflowRole: workflowRoleRule
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
