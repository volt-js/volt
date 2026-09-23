import { Component } from '@voltdev/core';

/**
 * An `ssg` page: nothing here depends on the request, so it can be built once.
 * The build does not write it yet, and the server renders it per request.
 *
 * The route table above says so; this file does not have to know.
 */
@Component({ selector: 'v-home', templateUrl: './home.html' })
export class Home {}
