import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { signIn } from '../../lib/auth';

async function loginAction(formData: FormData) {
  'use server';
  try {
    await signIn('credentials', {
      email: formData.get('email'),
      password: formData.get('password'),
      redirectTo: '/',
    });
  } catch (err) {
    // signIn throws NEXT_REDIRECT on success — only swallow real auth failures.
    if (err instanceof AuthError) redirect('/login?error=1');
    throw err;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="login">
      <h1>AgencyOS</h1>
      {error && <p className="error">Invalid email or password.</p>}
      <form action={loginAction}>
        <input name="email" type="email" placeholder="Email" required autoFocus />
        <input name="password" type="password" placeholder="Password" required />
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
