import multer from 'multer';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'application/vnd.google-earth.kml+xml',
    'application/vnd.google-earth.kmz',
    'application/octet-stream',
    'application/xml',
    'text/xml'
  ];

  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.kml', '.kmz'];
  const ext = file.originalname ? file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.')) : '';

  if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new ApiError(HTTP_STATUS.BAD_REQUEST, `Unsupported file format: ${file.mimetype} (Ext: ${ext})`), false);
  }
};

export const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
  fileFilter,
});

const multerUploadFields = upload.fields([
  // Springshed Fields
  { name: 'closeUpPhoto', maxCount: 1 },
  { name: 'wideAnglePhoto', maxCount: 1 },
  { name: 'selfieWithSpring', maxCount: 1 },
  { name: 'kmlFile', maxCount: 50 },
  { name: 'dharaNaulaDetails', maxCount: 1 },
  { name: 'mouSpringRejuvenation', maxCount: 1 },
  { name: 'dlecMinutes', maxCount: 1 },

  // Streamshed Fields
  { name: 'attachLandCoverMap', maxCount: 1 },
  { name: 'mainStreamPhoto', maxCount: 1 },
  { name: 'tributariesConfluencePhoto', maxCount: 1 },
  { name: 'geoCoordinatesFile', maxCount: 1 },
  { name: 'geoLocationFile', maxCount: 1 },

  // Groundwater Fields
  { name: 'rechargeSitePhoto', maxCount: 1 },
  { name: 'interventionSitePhoto', maxCount: 1 },

  // Shared Fields
  { name: 'detailProjectReport', maxCount: 1 },
  { name: 'otherDocuments', maxCount: 1 },
  { name: 'signatureWithStamp', maxCount: 1 },
]);

export const uploadDPRFields = (req, res, next) => {
  multerUploadFields(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const fieldNameMap = {
          closeUpPhoto: 'Close-up Photo',
          wideAnglePhoto: 'Wide Angle Photo',
          selfieWithSpring: 'Selfie with Spring',
          kmlFile: 'KML File',
          detailProjectReport: 'Detail Project Report',
          dharaNaulaDetails: 'Dhara Naula Details',
          mouSpringRejuvenation: 'MOU for Spring Rejuvenation',
          dlecMinutes: 'DLEC Minutes',
          otherDocuments: 'Other Documents',
          signatureWithStamp: 'Signature with Stamp'
        };
        const friendlyName = fieldNameMap[err.field] || err.field;
        return next(new ApiError(HTTP_STATUS.BAD_REQUEST, `File too large: The file for '${friendlyName}' exceeds the 50MB size limit.`));
      }
      return next(new ApiError(HTTP_STATUS.BAD_REQUEST, err.message));
    } else if (err) {
      return next(err);
    }
    next();
  });
};

// Keep backward-compatible alias
export const uploadFields = (fieldsOrReq, res, next) => {
  // If called as factory: uploadFields([{ name: 'x', maxCount: 1 }])
  if (Array.isArray(fieldsOrReq)) {
    const dynamicUpload = upload.fields(fieldsOrReq);
    return (req, res, next) => {
      dynamicUpload(req, res, (err) => {
        if (err instanceof multer.MulterError) {
          return next(new ApiError(HTTP_STATUS.BAD_REQUEST, err.message));
        } else if (err) {
          return next(err);
        }
        next();
      });
    };
  }
  // If called as middleware directly (backward compat): uploadFields(req, res, next)
  return uploadDPRFields(fieldsOrReq, res, next);
};

export const parseFormDataJson = (req, res, next) => {
  if (req.body) {
    for (const key in req.body) {
      if (typeof req.body[key] === 'string') {
        try {
          const parsed = JSON.parse(req.body[key]);
          req.body[key] = parsed;
        } catch (e) {
          // Ignore parse errors for normal text fields
        }
      }
    }

    // If the frontend sent a 'data' wrapper key, spread it into req.body
    if (req.body.data && typeof req.body.data === 'object' && !Array.isArray(req.body.data)) {
      Object.assign(req.body, req.body.data);
      delete req.body.data;
    }

    // Special handling for Streamshed/Springshed jsonData pattern
    if (req.body.jsonData && typeof req.body.jsonData === 'object') {
      Object.assign(req.body, req.body.jsonData);
      delete req.body.jsonData;
    }
  }
  next();
};
