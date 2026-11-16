import { Router } from 'express';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { auditLog } from '../middlewares/audit.middleware.js';
import USER_ROLES from '../constants/roles.constants.js';
import * as ctrl from '../controllers/masterData.controller.js';

/**
 * Master data used by project creation.
 * Reading is open to every authenticated user; adding new master records is
 * limited to state-level admins, except Gram Panchayats and villages, which
 * district and PIA officers may add inside their own district.
 */
const router = Router();
router.use(verifyAccessToken);

const adminOnly = requireRole(USER_ROLES.SUPER_ADMIN);
// Gram Panchayats and villages can also be added by district and PIA officers, within their own district.
const locationMakers = requireRole(USER_ROLES.SUPER_ADMIN, USER_ROLES.DD_LEVEL, USER_ROLES.PIA_OFFICER);

// Locations: District → Block → Gram Panchayat → Village
router.get('/locations/districts', ctrl.getDistricts);
router.get('/locations/blocks', ctrl.getBlocks);
router.get('/locations/gram-panchayats', ctrl.getGramPanchayats);
router.get('/locations/villages', ctrl.getVillages);

router.post('/locations/blocks', adminOnly, auditLog('CREATE_BLOCK'), ctrl.createBlock);
router.post('/locations/gram-panchayats', locationMakers, auditLog('CREATE_GRAM_PANCHAYAT'), ctrl.createGramPanchayat);
router.post('/locations/villages', locationMakers, auditLog('CREATE_VILLAGE'), ctrl.createVillage);

// Departments
router.get('/departments', ctrl.getDepartments);
router.post('/departments', adminOnly, auditLog('CREATE_DEPARTMENT'), ctrl.createDepartment);

// Budget heads and their activities
router.get('/heads', ctrl.getHeads);
router.get('/heads/:headId/activities', ctrl.getHeadActivities);

export default router;
