import { Component, ContentChild, Input, OnInit } from '@angular/core'

@Component({
  selector: 'app-test-projection-init',
  template: `
    <p>
      Simple component to test the init or lack of init of projected components
      through Toggly's Feature component.
    </p>
  `,
  styles: [],
})
export class TestProjectionInitComponent implements OnInit {
  constructor() {}

  ngOnInit(): void {
    console.log('TestProjectionInitComponent --- init')
  }
}
