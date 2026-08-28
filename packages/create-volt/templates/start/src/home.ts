import { Component } from '@voltdev/core';

/**
 * An `ssg` page: nothing here depends on the request, so it is built once.
 *
 * The route table above says so; this file does not have to know.
 */
@Component({ selector: 'v-home', templateUrl: './home.html' })
export class Home {}
