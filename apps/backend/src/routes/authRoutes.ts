import { Router } from 'express';
import { demoLogin } from '../controllers/authController';

const router = Router();

router.post('/demo-login', demoLogin);

export default router;
