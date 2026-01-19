import { Component, OnInit } from '@angular/core'

@Component({
  selector: 'app-test-projection-init',
  standalone: true,
  template: `
    <p>
      Simple component to test the init or lack of init of projected components
      through Toggly's Feature component.
    </p>
  `,
  styles: [],
})
export class TestProjectionInitComponent implements OnInit {
  ngOnInit(): void {
    console.log('TestProjectionInitComponent --- init')
  }
}
