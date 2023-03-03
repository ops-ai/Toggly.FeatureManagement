import { TestBed } from '@angular/core/testing';

import { TogglyService } from './toggly.service';

describe('TogglyService', () => {
  let service: TogglyService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TogglyService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
