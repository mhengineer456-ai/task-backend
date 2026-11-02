import { Router } from 'express';
import { loginUser, registerUser, resendOtp, verifyOtp } from '../controllers/authController.js';

const router = Router();

router.post('/login', loginUser);
router.post('/register', registerUser);
router.post('/resend-otp', resendOtp);
router.post('/verify-otp', verifyOtp);

export default router;
