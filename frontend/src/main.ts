import 'bootstrap';
import dayjs from 'dayjs/esm';
import customParseFormat from 'dayjs/esm/plugin/customParseFormat';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// customParseFormat: dayjs only parses ISO 8601 out of the box — the app
// parses explicit formats like 'YYYY-MM-DD' and 'HH:mm' in several places.
dayjs.extend(customParseFormat);

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
