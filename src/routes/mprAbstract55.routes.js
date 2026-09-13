import express from 'express';
import {
  saveFormDraft,
  submitForm,
  getMyFormsList,
  getSingleForm,
  approveFormController,
  rejectFormController,
  getPreviousMonth,
  getSummary,
  getDistrictSummary,
  getFullAnalytics,
  getAllFormsList,
  resubmitForm
} from '../controllers/mprAbstract55.controller.js';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = express.Router();

router.use(verifyAccessToken);

router.post('/draft', requireRole('MND_OFFICER'), saveFormDraft);
router.post('/submit', requireRole('MND_OFFICER'), submitForm);
router.patch('/:id/resubmit', requireRole('MND_OFFICER'), resubmitForm);

router.get('/my-reports', requireRole('MND_OFFICER'), getMyFormsList);
router.get('/all-reports', requireRole('MND_SUPER_ADMIN'), getAllFormsList);
router.get('/previous-month', requireRole('MND_OFFICER'), getPreviousMonth);

router.get('/summary', requireRole('MND_OFFICER', 'MND_SUPER_ADMIN'), getSummary);
router.get('/district-summary', requireRole('MND_OFFICER', 'MND_SUPER_ADMIN'), getDistrictSummary);
router.get('/analytics/full', requireRole('MND_SUPER_ADMIN', 'MND_OFFICER'), getFullAnalytics);

router.get('/:id', requireRole('MND_OFFICER', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), getSingleForm);

router.patch('/:id/approve', requireRole('MND_SUPER_ADMIN', 'SUPER_ADMIN'), approveFormController);
router.patch('/:id/reject', requireRole('MND_SUPER_ADMIN', 'SUPER_ADMIN'), rejectFormController);

export default router;
