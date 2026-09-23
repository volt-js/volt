import { Server, guard } from '@voltdev/server';

export class Api {
  @Server()
  async currentPlan(): Promise<string> {
    const who = await guard((request) => ({ user: request.headers.get('x-user') ?? 'anonymous' }));
    return who.user === 'anonymous' ? 'Free' : 'Team';
  }
}

const api = new Api();

export const currentPlan = (): Promise<string> => api.currentPlan();
