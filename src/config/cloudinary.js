import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import logger from './logger.js';

dotenv.config();

try {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  logger.info('Cloudinary configured successfully');
} catch (error) {
  logger.error(`Cloudinary configuration error: ${error.message}`);
}

export default cloudinary;
