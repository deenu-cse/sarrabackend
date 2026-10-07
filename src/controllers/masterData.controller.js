import * as masterData from '../services/masterData.service.js';
import { LOCATION_TYPES } from '../models/Location.model.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

const ok = (res, data, message) => res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, message));
const created = (res, data, message) => res.status(HTTP_STATUS.CREATED).json(new ApiResponse(HTTP_STATUS.CREATED, data, message));

// A repeated query param arrives as an array; only a single string id is valid.
const single = (value) => (typeof value === 'string' ? value : '');

// ─── Locations ───────────────────────────────────────────────────────────────

export const getDistricts = asyncHandler(async (req, res) => {
  ok(res, await masterData.listDistricts(), 'Districts fetched');
});

export const getBlocks = asyncHandler(async (req, res) => {
  ok(res, await masterData.listChildLocations(LOCATION_TYPES.BLOCK, single(req.query.districtId)), 'Blocks fetched');
});

export const getGramPanchayats = asyncHandler(async (req, res) => {
  ok(res, await masterData.listChildLocations(LOCATION_TYPES.GRAM_PANCHAYAT, single(req.query.blockId)), 'Gram Panchayats fetched');
});

export const getVillages = asyncHandler(async (req, res) => {
  ok(res, await masterData.listChildLocations(LOCATION_TYPES.VILLAGE, single(req.query.gramPanchayatId)), 'Villages fetched');
});

export const createBlock = asyncHandler(async (req, res) => {
  const block = await masterData.createChildLocation(LOCATION_TYPES.BLOCK, single(req.body.districtId), req.body.name, req.user);
  res.locals.auditTargetId = block.id;
  created(res, block, 'Block added successfully');
});

export const createGramPanchayat = asyncHandler(async (req, res) => {
  const gp = await masterData.createChildLocation(LOCATION_TYPES.GRAM_PANCHAYAT, single(req.body.blockId), req.body.name, req.user);
  res.locals.auditTargetId = gp.id;
  created(res, gp, 'Gram Panchayat added successfully');
});

export const createVillage = asyncHandler(async (req, res) => {
  const village = await masterData.createChildLocation(LOCATION_TYPES.VILLAGE, single(req.body.gramPanchayatId), req.body.name, req.user);
  res.locals.auditTargetId = village.id;
  created(res, village, 'Village added successfully');
});

// ─── Departments ─────────────────────────────────────────────────────────────

export const getDepartments = asyncHandler(async (req, res) => {
  ok(res, await masterData.listDepartments(), 'Departments fetched');
});

export const createDepartment = asyncHandler(async (req, res) => {
  const department = await masterData.createDepartment(req.body.name, req.user);
  res.locals.auditTargetId = department.id;
  created(res, department, 'Department added successfully');
});

// ─── Heads ───────────────────────────────────────────────────────────────────

export const getHeads = asyncHandler(async (req, res) => {
  ok(res, await masterData.listHeads(), 'Heads fetched');
});

export const getHeadActivities = asyncHandler(async (req, res) => {
  ok(res, await masterData.getHeadActivities(req.params.headId), 'Head activities fetched');
});
