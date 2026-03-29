import { redirect } from 'next/navigation';

export default async function ArenaDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/markets/${id}`);
}
