import { Router } from 'express';
import * as streamshedDPRController from '../controllers/streamshedDPR.controller.js';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import USER_ROLES from '../constants/roles.constants.js';
import { uploadFields, parseFormDataJson } from '../middlewares/upload.middleware.js';
import { audit } from '../middlewares/audit.middleware.js';
import { uploadLimiter } from '../middlewares/rateLimiter.middleware.js';

const router = Router();

router.use(verifyAccessToken);

// PIA Officer Routes
router.post(
  '/draft',
  requireRole(USER_ROLES.PIA_OFFICER),
  uploadLimiter,
  uploadFields,
  parseFormDataJson,
  audit('FORM_DRAFT_SAVE', () => 'StreamshedDPR'),
  streamshedDPRController.saveDraft
);

router.post(
  '/submit',
  requireRole(USER_ROLES.PIA_OFFICER),
  uploadLimiter,
  uploadFields,
  parseFormDataJson,
  audit('FORM_SUBMIT', () => 'StreamshedDPR'),
  streamshedDPRController.submitForm
);

router.get('/my-forms', requireRole(USER_ROLES.PIA_OFFICER), streamshedDPRController.getMyForms);

router.patch(
  '/:id/resubmit',
  requireRole(USER_ROLES.PIA_OFFICER),
  uploadLimiter,
  uploadFields,
  parseFormDataJson,
  audit('FORM_SUBMIT', () => 'StreamshedDPR'),
  streamshedDPRController.resubmitForm
);

router.delete('/:id', requireRole(USER_ROLES.PIA_OFFICER), streamshedDPRController.deleteForm);

// DD Level Routes
router.get('/district/pending', requireRole(USER_ROLES.DD_LEVEL, USER_ROLES.SUPER_ADMIN), streamshedDPRController.getDistrictPendingForms);
router.patch('/:id/status', requireRole(USER_ROLES.DD_LEVEL, USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN), streamshedDPRController.updateStatus);
router.patch('/:id/approve', requireRole(USER_ROLES.DD_LEVEL, USER_ROLES.SUPER_ADMIN), audit('FORM_APPROVE', () => 'StreamshedDPR'), streamshedDPRController.approveForm);
router.patch('/:id/reject', requireRole(USER_ROLES.DD_LEVEL, USER_ROLES.SUPER_ADMIN), audit('FORM_REJECT', () => 'StreamshedDPR'), streamshedDPRController.rejectForm);


// Shared (officers see own, DD sees district, admin sees all — enforced in controller)
router.get('/:id',
  requireRole(USER_ROLES.PIA_OFFICER, USER_ROLES.DD_LEVEL, USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN),
  streamshedDPRController.getFormById
);

export default router;
