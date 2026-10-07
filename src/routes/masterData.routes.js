import { Router } from 'express';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { auditLog } from '../middlewares/audit.middleware.js';
import USER_ROLES from '../constants/roles.constants.js';
import * as ctrl from '../controllers/masterData.controller.js';

/**
 * Master data used by project creation.
 * Reading is open to every authenticated user; adding new master records is
 * limited to state-level admins.
 */
const router = Router();
router.use(verifyAccessToken);

const adminOnly = requireRole(USER_ROLES.SUPER_ADMIN);

// Locations: District → Block → Gram Panchayat → Village
router.get('/locations/districts', ctrl.getDistricts);
router.get('/locations/blocks', ctrl.getBlocks);
router.get('/locations/gram-panchayats', ctrl.getGramPanchayats);
router.get('/locations/villages', ctrl.getVillages);

router.post('/locations/blocks', adminOnly, auditLog('CREATE_BLOCK'), ctrl.createBlock);
router.post('/locations/gram-panchayats', adminOnly, auditLog('CREATE_GRAM_PANCHAYAT'), ctrl.createGramPanchayat);
router.post('/locations/villages', adminOnly, auditLog('CREATE_VILLAGE'), ctrl.createVillage);

// Departments
router.get('/departments', ctrl.getDepartments);
router.post('/departments', adminOnly, auditLog('CREATE_DEPARTMENT'), ctrl.createDepartment);

// Budget heads and their activities
router.get('/heads', ctrl.getHeads);
router.get('/heads/:headId/activities', ctrl.getHeadActivities);

export default router;
