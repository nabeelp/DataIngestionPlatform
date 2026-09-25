// =============================================================================
// Rule Controller - Business logic for Validation Rules
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import * as RuleService from '../services/Rule.service';
import type { 
    ICreateRuleDto, 
    IUpdateRuleDto 
} from '../interfaces/rule.interface';
import { IJwtPayload } from '../interfaces/user.interface';
import { logger } from '../utils/logger';

// Extend Request to include user
export interface AuthRequest extends Request {
    user?: IJwtPayload;
}

/**
 * Get all rules for a specific file definition
 */
export const getRules = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const fileDefinitionId = req.params.fileDefinitionId as string;
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        if (!fileDefinitionId) {
            return res.status(400).json({ 
                success: false, 
                message: 'File Definition ID is required' 
            });
        }

        const rules = await RuleService.getRulesByFileDefinitionId(fileDefinitionId, userId);

        res.json({
            success: true,
            rules,
            total: rules.length
        });
    } catch (error) {
        logger.error('[RULE_CONTROLLER] Error getting rules:', error);
        
        // Handle access denied error
        if (error instanceof Error && error.message === 'Access denied to this file definition') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied to this file definition' 
            });
        }
        
        next(error);
    }
};

/**
 * Get a single rule by ID
 */
export const getRuleById = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const ruleId = req.params.id as string;
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        if (!ruleId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Rule ID is required' 
            });
        }

        const rule = await RuleService.getRuleById(ruleId, userId);

        if (!rule) {
            return res.status(404).json({ 
                success: false, 
                message: 'Rule not found' 
            });
        }

        res.json({
            success: true,
            rule
        });
    } catch (error) {
        logger.error('[RULE_CONTROLLER] Error getting rule:', error);
        
        if (error instanceof Error && error.message === 'Access denied to this rule') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied to this rule' 
            });
        }
        
        next(error);
    }
};

/**
 * Create a new rule
 */
export const createRule = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        const { 
            FileDefinitionId, 
            Name, 
            Description, 
            RuleType, 
            Severity, 
            ExecutionOrder, 
            SqlQuery, 
            IsEnabled 
        } = req.body;

        // Validate required fields
        if (!FileDefinitionId || !Name || !SqlQuery) {
            return res.status(400).json({ 
                success: false, 
                message: 'FileDefinitionId, Name, and SqlQuery are required' 
            });
        }

        const dto: ICreateRuleDto = {
            FileDefinitionId,
            Name,
            Description,
            RuleType,
            Severity,
            ExecutionOrder,
            SqlQuery,
            IsEnabled
        };

        const rule = await RuleService.createRule(dto, userId);

        res.status(201).json({
            success: true,
            rule,
            message: 'Rule created successfully'
        });
    } catch (error) {
        logger.error('[RULE_CONTROLLER] Error creating rule:', error);
        
        if (error instanceof Error && error.message === 'Access denied to this file definition') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied to this file definition' 
            });
        }
        
        if (error instanceof RuleService.RuleValidationError) {
            return res.status(400).json({ success: false, message: error.message });
        }

        next(error);
    }
};

/**
 * Update a rule
 */
export const updateRule = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const ruleId = req.params.id as string;
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        if (!ruleId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Rule ID is required' 
            });
        }

        const { 
            Name, 
            Description, 
            RuleType, 
            Severity, 
            ExecutionOrder, 
            SqlQuery, 
            IsEnabled 
        } = req.body;

        const updates: IUpdateRuleDto = {};
        
        if (Name !== undefined) updates.Name = Name;
        if (Description !== undefined) updates.Description = Description;
        if (RuleType !== undefined) updates.RuleType = RuleType;
        if (Severity !== undefined) updates.Severity = Severity;
        if (ExecutionOrder !== undefined) updates.ExecutionOrder = ExecutionOrder;
        if (SqlQuery !== undefined) updates.SqlQuery = SqlQuery;
        if (IsEnabled !== undefined) updates.IsEnabled = IsEnabled;

        const rule = await RuleService.updateRule(ruleId, updates, userId);

        if (!rule) {
            return res.status(404).json({ 
                success: false, 
                message: 'Rule not found' 
            });
        }

        res.json({
            success: true,
            rule,
            message: 'Rule updated successfully'
        });
    } catch (error) {
        logger.error('[RULE_CONTROLLER] Error updating rule:', error);
        
        if (error instanceof Error && error.message === 'Access denied to this rule') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied to this rule' 
            });
        }
        
        if (error instanceof RuleService.RuleValidationError) {
            return res.status(400).json({ success: false, message: error.message });
        }

        next(error);
    }
};

/**
 * Delete a rule
 */
export const deleteRule = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const ruleId = req.params.id as string;
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        if (!ruleId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Rule ID is required' 
            });
        }

        await RuleService.deleteRule(ruleId, userId);

        res.json({
            success: true,
            message: 'Rule deleted successfully'
        });
    } catch (error) {
        logger.error('[RULE_CONTROLLER] Error deleting rule:', error);
        
        if (error instanceof Error && error.message === 'Access denied to this rule') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied to this rule' 
            });
        }
        
        next(error);
    }
};

/**
 * Toggle rule enabled/disabled status
 */
export const toggleRule = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const ruleId = req.params.id as string;
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        if (!ruleId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Rule ID is required' 
            });
        }

        const rule = await RuleService.toggleRuleEnabled(ruleId, userId);

        if (!rule) {
            return res.status(404).json({ 
                success: false, 
                message: 'Rule not found' 
            });
        }

        res.json({
            success: true,
            rule,
            message: `Rule ${rule.IsEnabled ? 'enabled' : 'disabled'} successfully`
        });
    } catch (error) {
        logger.error('[RULE_CONTROLLER] Error toggling rule:', error);
        
        if (error instanceof Error && error.message === 'Access denied to this rule') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied to this rule' 
            });
        }
        
        if (error instanceof RuleService.RuleValidationError) {
            return res.status(400).json({ success: false, message: error.message });
        }

        next(error);
    }
};

