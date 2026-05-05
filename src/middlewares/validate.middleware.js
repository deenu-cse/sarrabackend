import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

export const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });

  if (error) {
    const errorMessages = error.details.map((detail) => detail.message);
    return next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'Validation Error', errorMessages));
  }

  req.body = value;
  next();
};
