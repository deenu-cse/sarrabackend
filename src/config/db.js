import mongoose from 'mongoose';
import logger from './logger.js';
import { seedMasterData } from '../services/masterData.service.js';
import { seedOutcomeIndicators } from '../services/projectOutcome.service.js';
import { startScheduler } from '../services/monitoring.service.js';

const connectDB = async () => {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 5000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const conn = await mongoose.connect(process.env.MONGODB_URI, {
        autoIndex: process.env.NODE_ENV !== 'production',
      });
      logger.info(`MongoDB Connected: ${conn.connection.host}`);
      
      // Setup event listeners for the connection
      mongoose.connection.on('error', (err) => {
        logger.error(`MongoDB connection error: ${err}`);
      });
      
      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
      });

      // First-run seed of master data (no-op once the collections have data)
      await seedMasterData();
      await seedOutcomeIndicators();
      startScheduler();

      return conn;
    } catch (error) {
      logger.error(`MongoDB connection attempt ${attempt} failed: ${error.message}`);
      if (attempt === MAX_RETRIES) {
        logger.error('Max connection retries reached. Exiting.');
        process.exit(1);
      }
      logger.info(`Retrying in ${RETRY_DELAY / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
};

export default connectDB;
