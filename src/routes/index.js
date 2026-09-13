import { Router } from 'express';
import authRoutes from './auth.routes.js';
import adminRoutes from './admin.routes.js';
import mprAdminRoutes from './mprAdmin.routes.js';
import reportRoutes from './report.routes.js';
import mprAbstract55Routes from './mprAbstract55.routes.js';
import mprPraroop1ARoutes from './mprPraroop1A.routes.js';
import mprPraroop1BRoutes from './mprPraroop1B.routes.js';
import mprPraroop1CRoutes from './mprPraroop1C.routes.js';
import mprPraroop1DRoutes from './mprPraroop1D.routes.js';
import sanctionRoutes from './sanction.routes.js';
import { apiLimiter } from '../middlewares/rateLimiter.middleware.js';
import ApiResponse from '../utils/ApiResponse.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

const router = Router();

router.get('/health', (req, res) => {
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, {
    status: 'up',
    timestamp: new Date().toISOString()
  }, 'Server is healthy'));
});

router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/reports', reportRoutes);
router.use('/mpr-admin', mprAdminRoutes);
router.use('/mpr/abstract55', mprAbstract55Routes);
router.use('/mpr/praroop1a', mprPraroop1ARoutes);
router.use('/mpr/praroop1b', mprPraroop1BRoutes);
router.use('/mpr/praroop1c', mprPraroop1CRoutes);
router.use('/mpr/praroop1d', mprPraroop1DRoutes);
router.use('/sanctions', sanctionRoutes);

export default router;
