import express from 'express';
import adminRoutes from './admin.routes';
import authRoutes from './auth.routes';
import definitionRoutes from './definition.routes';
import ruleRoutes from './rule.routes';
import uploadRoutes from './upload.routes';

const router = express.Router();

// API routes v1
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/definitions', definitionRoutes);
router.use('/rules', ruleRoutes);
router.use('/uploads', uploadRoutes);

export default router;
