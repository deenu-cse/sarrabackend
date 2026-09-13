import AuditLog from '../models/AuditLog.model.js';
import asyncHandler from '../utils/asyncHandler.js';

export const auditLog = (action, targetResourceFunc = () => null) => {
  return asyncHandler(async (req, res, next) => {
    res.on('finish', async () => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        try {
          const targetResource = targetResourceFunc(req, res) || req.baseUrl;
          let targetId = null;

          if (res.locals && res.locals.auditTargetId) {
            targetId = res.locals.auditTargetId;
          } else if (req.params && req.params.id) {
            targetId = req.params.id;
          }

          await AuditLog.create({
            action,
            performedBy: req.user ? req.user._id : null,
            performedByRole: req.user ? req.user.role : null,
            targetResource,
            targetId,
            ipAddress: req.ip || req.connection.remoteAddress,
            userAgent: req.headers['user-agent'],
            metadata: {
              method: req.method,
              originalUrl: req.originalUrl,
              statusCode: res.statusCode,
              ...(res.locals?.auditMetadata || {})
            }
          });
        } catch (error) {
          console.error('Failed to create audit log:', error);
        }
      }
    });

    next();
  });
};
