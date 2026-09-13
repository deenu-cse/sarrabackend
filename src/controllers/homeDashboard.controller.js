import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import { getHomeDashboard } from '../services/homeDashboard.service.js';

export const getHome = asyncHandler(async (req, res) => {
  const data = await getHomeDashboard(req.user);
  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, data, 'Home dashboard fetched successfully'));
});
