import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useGuestMode } from '@/hooks/useGuestMode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { UserCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { z } from 'zod';
import { BottorLogo } from '@/components/BottorLogo';

const authSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { signIn, signUp, user } = useAuth();
  const { enterGuestMode } = useGuestMode();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const validation = authSchema.safeParse({ email, password });
    if (!validation.success) {
      toast({
        title: 'Validation Error',
        description: validation.error.errors[0].message,
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = isLogin 
        ? await signIn(email, password)
        : await signUp(email, password);

      if (error) {
        let message = error.message;
        if (error.message.includes('User already registered')) {
          message = 'An account with this email already exists. Try logging in instead.';
        } else if (error.message.includes('Invalid login credentials')) {
          message = 'Invalid email or password. Please try again.';
        }
        toast({
          title: isLogin ? 'Login Failed' : 'Sign Up Failed',
          description: message,
          variant: 'destructive',
        });
      } else if (!isLogin) {
        toast({
          title: 'Account Created!',
          description: 'You can now start using Bottor Assist.',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGuestContinue = () => {
    enterGuestMode();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="mb-4">
            <BottorLogo size={64} className="mx-auto" />
          </div>
          <h1 className="text-2xl font-bold text-primary">Bottor Assist</h1>
          <p className="text-muted-foreground mt-1">Grade with your rubric. You review. You decide.</p>
        </div>

        <Card className="border border-border shadow-card">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-xl">
              {isLogin ? 'Welcome Back' : 'Create Account'}
            </CardTitle>
            <CardDescription>
              {isLogin 
                ? 'Sign in to access your grading sessions' 
                : 'Get started with Bottor Assist'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@school.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-12"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-12"
                />
              </div>
              <Button
                type="submit"
                variant="hero"
                className="w-full h-12"
                disabled={isSubmitting}
              >
                {isSubmitting 
                  ? 'Please wait...' 
                  : isLogin ? 'Sign In' : 'Create Account'}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => setIsLogin(!isLogin)}
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                {isLogin 
                  ? "Don't have an account? Sign up" 
                  : 'Already have an account? Sign in'}
              </button>
            </div>

            {/* Guest Mode Section */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <div className="space-y-3">
              <Button
                type="button"
                variant="outline"
                className="w-full h-12"
                onClick={handleGuestContinue}
              >
                <UserCircle className="w-5 h-5 mr-2" />
                Continue as Guest
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                No account needed to test Bottor Assist.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Status Banner */}
        <div className="mt-6 text-center">
          <p className="text-[13px] text-muted-foreground">
            Early access version — features may evolve based on educator feedback
          </p>
        </div>
      </div>
    </div>
  );
}
