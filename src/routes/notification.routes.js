import { Router } from 'express';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import {
  listNotifications,
  readAllNotifications,
  readNotification
} from '../controllers/notification.controller.js';

const router = Router();

router.use(verifyAccessToken);

router.get('/', listNotifications);
router.patch('/read-all', readAllNotifications);
router.patch('/:id/read', readNotification);

export default router;
