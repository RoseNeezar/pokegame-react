import React, { Component } from 'react'
import './Pokecard.css'
const POKE_API = "https://assets.pokemon.com/assets/cms2/img/pokedex/detail/";

let padTo3 = (num) => (num <= 999 ? `00${num}`.slice(-3) : num)

export default class Pokecard extends Component {
  render() {
    let POKE_URL = `${POKE_API}${padTo3(this.props.id)}.png`;
    return (
      <div className="Pokecard">
        <h1 className="Pokecard-name">{this.props.name}</h1>
        <div className="Pokecard-image">
        <img src={POKE_URL} alt={this.props.name}/>
        </div>
        <h2 className="Pokecard-data">TYPE: {this.props.type}</h2>
        <h2 className="Pokecard-data">EXP: {this.props.exp}</h2>
      </div>
    )
  }
}
