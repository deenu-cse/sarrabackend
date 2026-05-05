import { Router } from 'express';
import { 
  saveFormDraft, 
  submitDprForm, 
  getMyFormsList, 
  getSingleForm, 
  resubmitDprForm, 
  getDistrictPendingForms, 
  approveDprForm, 
  rejectDprForm,
  deleteDprForm,
  updateStatusController
} from '../controllers/groundwaterDPR.controller.js';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { uploadLimiter } from '../middlewares/rateLimiter.middleware.js';
import { audit } from '../middlewares/audit.middleware.js';
import { uploadFields, parseFormDataJson } from '../middlewares/upload.middleware.js';
import { submitDprSchema, rejectDprSchema } from '../validators/groundwaterDPR.validator.js';

const router = Router();

router.use(verifyAccessToken);

router.post(
  '/draft',
  requireRole('PIA_OFFICER'),
  uploadLimiter,
  uploadFields,
  parseFormDataJson,
  audit('FORM_DRAFT_SAVE', () => 'GroundwaterDPR'),
  saveFormDraft
);

router.post(
  '/submit',
  requireRole('PIA_OFFICER'),
  uploadLimiter,
  uploadFields,
  parseFormDataJson,
  validate(submitDprSchema),
  audit('FORM_SUBMIT', () => 'GroundwaterDPR'),
  submitDprForm
);

router.get(
  '/my-forms',
  requireRole('PIA_OFFICER'),
  getMyFormsList
);

router.patch(
  '/:id/resubmit',
  requireRole('PIA_OFFICER'),
  uploadLimiter,
  uploadFields,
  parseFormDataJson,
  audit('FORM_SUBMIT', () => 'GroundwaterDPR'),
  resubmitDprForm
);

router.delete(
  '/:id',
  requireRole('PIA_OFFICER'),
  audit('FORM_DELETE', () => 'GroundwaterDPR'),
  deleteDprForm
);

router.get(
  '/district/pending',
  requireRole('DD_LEVEL', 'SUPER_ADMIN'),
  getDistrictPendingForms
);

router.patch(
  '/:id/status',
  requireRole('DD_LEVEL', 'SUPER_ADMIN', 'MND_SUPER_ADMIN'),
  updateStatusController
);

router.patch(
  '/:id/approve',
  requireRole('DD_LEVEL', 'SUPER_ADMIN'),
  audit('FORM_APPROVE', () => 'GroundwaterDPR'),
  approveDprForm
);

router.patch(
  '/:id/reject',
  requireRole('DD_LEVEL', 'SUPER_ADMIN'),
  validate(rejectDprSchema),
  audit('FORM_REJECT', () => 'GroundwaterDPR'),
  rejectDprForm
);

router.get(
  '/:id',
  requireRole('PIA_OFFICER', 'DD_LEVEL', 'SUPER_ADMIN', 'MND_SUPER_ADMIN'),
  getSingleForm
);

export default router;
