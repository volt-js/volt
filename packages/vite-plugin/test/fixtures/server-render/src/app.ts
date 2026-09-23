import { Component } from '@voltdev/core';
import { useRouter } from '@voltdev/router';

@Component({ selector: 'v-app', templateUrl: './app.html' })
export default class App {
  router = useRouter();
  here(path: string): 'page' | undefined {
    return this.router.pathname() === path ? 'page' : undefined;
  }
}
