import { Router } from 'express';
import authRoutes from './auth.routes.js';
import springshedDprRoutes from './springsheddpr.routes.js';
import streamshedDPRRoutes from './streamshedDPR.routes.js';
import groundwaterDPRRoutes from './groundwaterDPR.routes.js';
import adminRoutes from './admin.routes.js';
import reportRoutes from './report.routes.js';
import mprAbstract55Routes from './mprAbstract55.routes.js';
import mprPraroop1ARoutes from './mprPraroop1A.routes.js';
import mprPraroop1BRoutes from './mprPraroop1B.routes.js';
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
router.use('/dpr/springshed', springshedDprRoutes);
router.use('/dpr/streamshed', streamshedDPRRoutes);
router.use('/dpr/groundwater', groundwaterDPRRoutes);
router.use('/admin', adminRoutes);
router.use('/reports', reportRoutes);
router.use('/mpr/abstract55', mprAbstract55Routes);
router.use('/mpr/praroop1a', mprPraroop1ARoutes);
router.use('/mpr/praroop1b', mprPraroop1BRoutes);

export default router;
